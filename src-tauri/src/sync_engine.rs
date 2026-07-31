use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Query},
    routing::get,
    Json, Router,
};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncEvent {
    pub id: String,
    pub entity_id: String,
    pub clock: u64,
    pub device_id: String,
    pub action: String,
    pub payload: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DumpItem {
    pub id: String,
    pub r#type: String,
    pub label: String,
    pub value: String,
    #[serde(rename = "folderId")]
    pub folder_id: Option<String>,
    #[serde(rename = "syncState")]
    pub sync_state: Option<String>,
}

pub struct AppState {
    db: Mutex<Connection>,
    device_id: String,
    pairing_code: Mutex<Option<String>>,
    app_handle: AppHandle,
    ws_tx: tokio::sync::broadcast::Sender<String>,
}

fn get_db_path(app: &AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().unwrap().join("boothub_events.db")
}

pub fn init_db(app: &AppHandle) -> Arc<AppState> {
    let db_path = get_db_path(app);
    std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
    get_boothub_docs_dir(app); // Ensure the Documents/BootHub directory is created on startup
    let conn = Connection::open(&db_path).expect("Failed to open DB");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL,
            clock INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            action TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
        CREATE INDEX IF NOT EXISTS idx_events_clock ON events(clock);
        
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            value TEXT NOT NULL,
            folderId TEXT,
            syncState TEXT
        );
        
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "
    ).unwrap();

    let device_id: String;
    let row: Result<String, _> = conn.query_row(
        "SELECT value FROM config WHERE key = 'device_id'",
        [],
        |row| row.get(0),
    );
    match row {
        Ok(id) => device_id = id,
        Err(_) => {
            device_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO config (key, value) VALUES (?1, ?2)",
                params!["device_id", &device_id],
            ).unwrap();
        }
    }

    let (ws_tx, _) = tokio::sync::broadcast::channel(100);

    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        device_id,
        pairing_code: Mutex::new(None),
        app_handle: app.clone(),
        ws_tx,
    });
    
    // Run initial sync to make sure file system structure exists
    let conn = state.db.lock().unwrap();
    sync_database_to_filesystem(app, &conn);
    drop(conn);

    state
}

#[tauri::command]
pub fn generate_pairing_code(state: tauri::State<'_, Arc<AppState>>) -> String {
    let code: String = (0..6).map(|_| (rand::random::<u8>() % 10).to_string()).collect();
    *state.pairing_code.lock().unwrap() = Some(code.clone());
    code
}

fn get_next_clock(conn: &Connection) -> u64 {
    let clock: u64 = conn.query_row(
        "SELECT COALESCE(MAX(clock), 0) FROM events",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    clock + 1
}

fn rebuild_materialized_view(app_handle: Option<&AppHandle>, conn: &Connection, entity_id: &str) {
    let mut stmt = conn.prepare("SELECT action, payload FROM events WHERE entity_id = ?1 ORDER BY clock ASC, device_id ASC").unwrap();
    let events = stmt.query_map(params![entity_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).unwrap();

    let mut current_item: Option<serde_json::Value> = None;

    for ev in events {
        if let Ok((action, payload_str)) = ev {
            if action == "ITEM_CREATED" || action == "ITEM_UPDATED" {
                if let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&payload_str) {
                    if let Some(ref mut curr) = current_item {
                        if let Some(obj) = curr.as_object_mut() {
                            if let Some(new_obj) = payload.as_object_mut() {
                                obj.append(new_obj);
                            }
                        }
                    } else {
                        let mut initial = serde_json::json!({"id": entity_id});
                        if let Some(obj) = initial.as_object_mut() {
                            if let Some(new_obj) = payload.as_object_mut() {
                                obj.append(new_obj);
                            }
                        }
                        current_item = Some(initial);
                    }
                }
            } else if action == "ITEM_DELETED" {
                current_item = None;
            }
        }
    }

    if let Some(item) = current_item {
        let r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
        let initial_val = item.get("value").and_then(|v| v.as_str()).unwrap_or("");
        
        conn.execute(
            "INSERT OR REPLACE INTO items (id, type, label, value, folderId, syncState) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item.get("id").and_then(|v| v.as_str()).unwrap_or(entity_id),
                r#type,
                item.get("label").and_then(|v| v.as_str()).unwrap_or(""),
                initial_val,
                item.get("folderId").and_then(|v| v.as_str()),
                "pending"
            ],
        ).unwrap();
        

    } else {
        if let Some(app) = app_handle {
            if let Some(existing_path) = get_file_path_for_id_existing(app, conn, entity_id) {
                let _ = std::fs::remove_file(existing_path);
            }
        }
        conn.execute("DELETE FROM items WHERE id = ?1", params![entity_id]).unwrap();
    }
}

fn append_event(state: &AppState, entity_id: &str, action: &str, payload: serde_json::Value) {
    let conn = state.db.lock().unwrap();
    let clock = get_next_clock(&conn);
    let id = Uuid::new_v4().to_string();
    let payload_str = payload.to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO events (id, entity_id, clock, device_id, action, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, entity_id, clock, &state.device_id, action, payload_str, created_at],
    ).unwrap();

    rebuild_materialized_view(Some(&state.app_handle), &conn, entity_id);
    sync_database_to_filesystem(&state.app_handle, &conn);
    let _ = state.ws_tx.send("SYNC_NEEDED".to_string());
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_items(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<DumpItem>, String> {
    let conn = state.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, type, label, value, folderId, syncState FROM items ORDER BY rowid DESC").map_err(|e| e.to_string())?;
    
    let items = stmt.query_map([], |row| {
        Ok(DumpItem {
            id: row.get(0)?,
            r#type: row.get(1)?,
            label: row.get(2)?,
            value: row.get(3)?,
            folder_id: row.get(4)?,
            sync_state: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    
    Ok(items)
}

#[tauri::command]
pub fn add_item(state: tauri::State<'_, Arc<AppState>>, id: String, r#type: String, value: String, label: Option<String>, folder_id: Option<String>) -> Result<(), String> {
    let final_label = label.unwrap_or_else(|| chrono::Local::now().format("%m-%d-%Y @ %H:%M").to_string());
    
    let mut payload = serde_json::json!({
        "type": r#type,
        "label": final_label,
        "value": value,
    });
    
    if let Some(fid) = folder_id {
        payload.as_object_mut().unwrap().insert("folderId".to_string(), serde_json::json!(fid));
    }

    append_event(&state, &id, "ITEM_CREATED", payload);
    Ok(())
}

#[tauri::command]
pub fn delete_item(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    append_event(&state, &id, "ITEM_DELETED", serde_json::json!({}));
    Ok(())
}

#[tauri::command]
pub fn update_item(state: tauri::State<'_, Arc<AppState>>, id: String, value: Option<String>, label: Option<String>) -> Result<(), String> {
    let mut payload = serde_json::Map::new();
    if let Some(v) = value {
        payload.insert("value".to_string(), serde_json::Value::String(v));
    }
    if let Some(l) = label {
        payload.insert("label".to_string(), serde_json::Value::String(l));
    }
    append_event(&state, &id, "ITEM_UPDATED", serde_json::Value::Object(payload));
    Ok(())
}

#[tauri::command]
pub fn set_item_folder(state: tauri::State<'_, Arc<AppState>>, id: String, folder_id: Option<String>) -> Result<(), String> {
    let payload = match folder_id {
        Some(fid) => serde_json::json!({ "folderId": fid }),
        None => serde_json::json!({ "folderId": null }),
    };
    append_event(&state, &id, "ITEM_UPDATED", payload);
    Ok(())
}

#[tauri::command]
pub fn disconnect(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    // 1. Broadcast FORCE_DISCONNECT over active WebSocket while still paired
    let _ = state.ws_tx.send("FORCE_DISCONNECT".to_string());
    
    // Brief sleep to ensure packet flushes out to network
    std::thread::sleep(std::time::Duration::from_millis(50));

    // 2. Clear paired keys from database
    let conn = state.db.lock().unwrap();
    conn.execute("DELETE FROM config WHERE key LIKE 'paired_%'", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── File Storage Commands ──────────────────────────────────────────────────────

fn get_boothub_docs_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let mut dir = app_handle.path().document_dir().unwrap_or_else(|_| app_handle.path().app_data_dir().unwrap());
    dir.push("BootHub");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn tab_to_folder_name(tab: &str) -> String {
    match tab {
        "photo" => "Photos".to_string(),
        "file" => "Files".to_string(),
        "text" => "Texts".to_string(),
        "link" => "Links".to_string(),
        _ => format!("{}s", tab),
    }
}

fn resolve_folder_path(conn: &rusqlite::Connection, folder_id: Option<String>, fallback_tab: &str) -> (String, String) {
    let mut tab = fallback_tab.to_string();
    if folder_id.is_none() {
        return (tab, "".to_string());
    }

    let mut path_parts = Vec::new();
    let mut current_id = folder_id.clone();
    let mut visited = std::collections::HashSet::new();

    while let Some(id) = current_id {
        if visited.contains(&id) { break; }
        visited.insert(id.clone());

        let mut stmt = conn.prepare("SELECT label, value, folderId FROM items WHERE id = ?1 AND type = 'folder'").unwrap();
        let res = stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?
            ))
        });

        if let Ok((label, value, parent_id)) = res {
            let mut folder_name = label.clone();
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&value) {
                if let Some(name) = json.get("name").and_then(|n| n.as_str()) {
                    folder_name = name.to_string();
                }
                if let Some(t) = json.get("tab").and_then(|t| t.as_str()) {
                    tab = t.to_string();
                }
            }
            
            let safe_name = folder_name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "").trim().to_string();
            let safe_name = if safe_name.is_empty() { "Folder".to_string() } else { safe_name };
            
            path_parts.insert(0, safe_name);
            current_id = parent_id;
        } else {
            break;
        }
    }

    (tab, path_parts.join("/"))
}

fn find_file_by_id_recursive(dir: &std::path::Path, id: &str) -> Option<std::path::PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_file_by_id_recursive(&path, id) {
                    return Some(found);
                }
            } else if let Ok(name) = entry.file_name().into_string() {
                if name.starts_with(id) {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn get_file_path_for_id_existing(app_handle: &tauri::AppHandle, conn: &rusqlite::Connection, id: &str) -> Option<std::path::PathBuf> {
    let base = get_boothub_docs_dir(app_handle);
    if let Some(found) = find_file_by_id_recursive(&base, id) {
        return Some(found);
    }
    
    let query = "SELECT type, label, value, folderId FROM items WHERE id = ?1";
    if let Ok((i_type, label, value, folder_id)) = conn.query_row(query, params![id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?
        ))
    }) {
        let expected = generate_expected_filename(conn, id, &i_type, &label, &value, &folder_id);
        let (tab, rel) = resolve_folder_path(conn, folder_id, &i_type);
        let mut dir = base.join(tab_to_folder_name(&tab));
        if !rel.is_empty() {
            dir.push(&rel);
        }
        let path = dir.join(expected);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn remove_empty_directories(dir: &std::path::Path, base: &std::path::Path, active_folders: &std::collections::HashSet<std::path::PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                remove_empty_directories(&path, base, active_folders);
            }
        }
    }
    
    if dir == base { return; }
    for rf in &["Photos", "Files", "Texts", "Links"] {
        if dir == base.join(rf) {
            return;
        }
    }
    
    if active_folders.contains(dir) { return; }
    
    let _ = std::fs::remove_dir(dir);
}

fn sync_database_to_filesystem(app: &AppHandle, conn: &rusqlite::Connection) {
    let base = get_boothub_docs_dir(app);
    
    for rf in &["Photos", "Files", "Texts", "Links"] {
        std::fs::create_dir_all(base.join(rf)).unwrap();
    }
    
    let mut stmt = conn.prepare("SELECT id, type, label, value, folderId FROM items").unwrap();
    let items: Vec<(String, String, String, String, Option<String>)> = stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?
        ))
    }).unwrap().filter_map(Result::ok).collect();
    
    let mut active_folders = std::collections::HashSet::new();
    for (id, item_type, _, _, _) in &items {
        if item_type == "folder" {
            let (tab, rel) = resolve_folder_path(conn, Some(id.clone()), "folder");
            let mut dir = base.join(tab_to_folder_name(&tab));
            if !rel.is_empty() {
                dir.push(&rel);
            }
            active_folders.insert(dir.clone());
            let _ = std::fs::create_dir_all(&dir);
        }
    }
    
    for (id, item_type, label, value, folder_id) in &items {
        if item_type == "folder" { continue; }
        
        let (tab, rel) = resolve_folder_path(conn, folder_id.clone(), item_type);
        let mut dir = base.join(tab_to_folder_name(&tab));
        if !rel.is_empty() {
            dir.push(&rel);
        }
        let _ = std::fs::create_dir_all(&dir);
        
        if item_type == "text" || item_type == "link" {
            let sanitized_label = label.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");
            let mut short_label = sanitized_label.trim().to_string();
            if short_label.is_empty() {
                short_label = item_type.to_string();
            }
            if short_label.len() > 30 {
                short_label.truncate(30);
            }
            let filename = format!("{}_{}.txt", id, short_label);
            let path = dir.join(&filename);
            let _ = std::fs::write(path, value);
        } else if item_type == "photo" || item_type == "file" {
            if let Some(existing) = find_file_by_id_recursive(&base, id) {
                let expected_filename = generate_expected_filename(conn, id, item_type, label, value, folder_id);
                let expected_path = dir.join(expected_filename);
                if existing != expected_path {
                    let _ = std::fs::rename(existing, expected_path);
                }
            }
        }
    }
    
    remove_empty_directories(&base, &base, &active_folders);
}

fn generate_expected_filename(conn: &rusqlite::Connection, id: &str, item_type: &str, label: &str, value: &str, folder_id: &Option<String>) -> String {
    let get_base = |i_id: &str, i_type: &str, i_label: &str, i_val: &str| -> String {
        let mut f_name = if i_type == "file" {
            let mut name_val = i_id.to_string();
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(i_val) {
                if let Some(name) = json.get("name").and_then(|n| n.as_str()) {
                    name_val = name.to_string();
                }
            }
            name_val
        } else if i_type == "photo" {
            let mut ext = "jpg".to_string();
            if i_val.contains('.') {
                let parts: Vec<&str> = i_val.split('.').collect();
                if let Some(last) = parts.last() {
                    ext = last.to_string();
                }
            }
            let mut sanitized_label = i_label.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");
            if sanitized_label.len() > 30 {
                sanitized_label.truncate(30);
            }
            format!("{}.{}", sanitized_label.trim(), ext)
        } else {
            i_id.to_string()
        };
        f_name.replace('/', "_").replace('\\', "_")
    };
    
    let base_name = get_base(id, item_type, label, value);
    
    let mut stmt = conn.prepare("SELECT id, label, value, folderId FROM items WHERE type = ?1 ORDER BY rowid ASC").unwrap();
    let mut siblings = Vec::new();
    let _ = stmt.query_map(params![item_type], |row| {
        let sid: String = row.get(0)?;
        let slabel: String = row.get(1)?;
        let svalue: String = row.get(2)?;
        let sfolder: Option<String> = row.get(3)?;
        Ok((sid, slabel, svalue, sfolder))
    }).map(|iter| {
        for res in iter.flatten() {
            if &res.3 == folder_id {
                let s_base = get_base(&res.0, item_type, &res.1, &res.2);
                if s_base == base_name {
                    siblings.push(res.0);
                }
            }
        }
    });
    
    if let Some(pos) = siblings.iter().position(|sid| sid == id) {
        if pos > 0 {
            if let Some(dot_idx) = base_name.rfind('.') {
                let (name, ext) = base_name.split_at(dot_idx);
                return format!("{} ({}){}", name, pos, ext);
            } else {
                return format!("{} ({})", base_name, pos);
            }
        }
    }
    
    base_name
}

fn get_new_file_path_for_id(app_handle: &tauri::AppHandle, id: &str, conn: &rusqlite::Connection) -> std::path::PathBuf {
    if let Some(existing) = get_file_path_for_id_existing(app_handle, conn, id) {
        let _ = std::fs::remove_file(existing);
    }
    let base = get_boothub_docs_dir(app_handle);

    let mut stmt = conn.prepare("SELECT type, label, value, folderId FROM items WHERE id = ?1").unwrap();
    let row = stmt.query_row(params![id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?
        ))
    });

    let (filename, folder_id, item_type) = if let Ok((i_type, label, value, f_id)) = row {
        (generate_expected_filename(conn, id, &i_type, &label, &value, &f_id), f_id, i_type)
    } else {
        (id.to_string(), None, "photo".to_string())
    };

    let (tab, rel) = resolve_folder_path(conn, folder_id, &item_type);
    let mut dir = base.join(tab_to_folder_name(&tab));
    if !rel.is_empty() {
        dir.push(&rel);
    }
    std::fs::create_dir_all(&dir).unwrap();

    dir.push(filename);
    dir
}


#[tauri::command]
pub fn save_file(state: tauri::State<'_, Arc<AppState>>, id: String, data: Vec<u8>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    let path = get_new_file_path_for_id(&state.app_handle, &id, &conn);
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<Vec<u8>, String> {
    let conn = state.db.lock().unwrap();
    if let Some(path) = get_file_path_for_id_existing(&state.app_handle, &conn, &id) {
        std::fs::read(&path).map_err(|e| e.to_string())
    } else {
        Err("File not found".to_string())
    }
}

#[tauri::command]
pub fn delete_file(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    if let Some(path) = get_file_path_for_id_existing(&state.app_handle, &conn, &id) {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

// ─── P2P Network Server ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SyncQuery {
    since: Option<u64>,
}

#[derive(Serialize)]
struct SyncResponse {
    events: Vec<SyncEvent>,
    max_clock: u64,
}

#[derive(Deserialize)]
struct SyncPayload {
    events: Vec<SyncEvent>,
}

#[allow(dead_code)]
fn is_device_paired(conn: &rusqlite::Connection) -> bool {
    let count: u64 = conn.query_row(
        "SELECT COUNT(*) FROM config WHERE key LIKE 'paired_%'",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    count > 0
}

fn get_auth_token_from_header(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") {
                return Some(auth_str[7..].to_string());
            }
        }
    }
    None
}

fn is_authenticated(conn: &rusqlite::Connection, headers: &axum::http::HeaderMap, addr: std::net::SocketAddr) -> bool {
    if addr.ip().is_loopback() {
        return true;
    }
    if let Some(token) = get_auth_token_from_header(headers) {
        let count: u64 = conn.query_row(
            "SELECT COUNT(*) FROM config WHERE key LIKE 'auth_token_%' AND value = ?1",
            params![token],
            |row| row.get(0),
        ).unwrap_or(0);
        return count > 0;
    }
    false
}

async fn handle_sync_get(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Query(query): Query<SyncQuery>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let conn = state.db.lock().unwrap();
    if !is_authenticated(&conn, &headers, addr) {
        return axum::response::Response::builder()
            .status(403)
            .body(axum::body::Body::from("forbidden"))
            .unwrap();
    }
    let since = query.since.unwrap_or(0);
    let mut stmt = conn.prepare("SELECT id, entity_id, clock, device_id, action, payload, created_at FROM events WHERE clock > ?1 ORDER BY clock ASC").unwrap();
    
    let events: Vec<SyncEvent> = stmt.query_map(params![since], |row| {
        Ok(SyncEvent {
            id: row.get(0)?,
            entity_id: row.get(1)?,
            clock: row.get(2)?,
            device_id: row.get(3)?,
            action: row.get(4)?,
            payload: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).unwrap().filter_map(Result::ok).collect();

    let max_clock = get_next_clock(&conn) - 1;

    Json(SyncResponse { events, max_clock }).into_response()
}

async fn handle_sync_post(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<SyncPayload>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let mut conn = state.db.lock().unwrap();
    if !is_authenticated(&conn, &headers, addr) {
        return axum::response::Response::builder()
            .status(403)
            .body(axum::body::Body::from("forbidden"))
            .unwrap();
    }
    let tx = conn.transaction().unwrap();
    
    let mut updated_entities = Vec::new();

    for ev in payload.events {
        let exists: Result<String, _> = tx.query_row("SELECT id FROM events WHERE id = ?1", params![ev.id], |row| row.get(0));
        if exists.is_err() {
            tx.execute(
                "INSERT INTO events (id, entity_id, clock, device_id, action, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![ev.id, ev.entity_id, ev.clock, ev.device_id, ev.action, ev.payload, ev.created_at],
            ).unwrap();
            updated_entities.push(ev.entity_id);
        }
    }
    
    tx.commit().unwrap();
    
    for entity in updated_entities {
        rebuild_materialized_view(Some(&state.app_handle), &conn, &entity);
    }
    
    sync_database_to_filesystem(&state.app_handle, &conn);
    
    let _ = state.ws_tx.send("SYNC_NEEDED".to_string());
    
    // Notify frontend of update
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.emit("storage-updated", ());
    }
    
    Json("ok").into_response()
}

fn get_desktop_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Desktop PC".to_string())
}

#[derive(Deserialize)]
pub struct PairRequest {
    code: String,
    device_id: String,
    device_name: Option<String>,
}

#[derive(Serialize)]
pub struct PairResponse {
    success: bool,
    device_id: Option<String>,
    device_name: Option<String>,
    auth_token: Option<String>,
}

#[derive(Deserialize)]
pub struct UnpairRequest {
    device_id: String,
}

async fn handle_unpair_post(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<UnpairRequest>,
) -> Json<&'static str> {
    let conn = state.db.lock().unwrap();
    let _ = conn.execute("DELETE FROM config WHERE key = ?1", params![format!("paired_{}", payload.device_id)]);
    let _ = conn.execute("DELETE FROM config WHERE key = ?1", params![format!("auth_token_{}", payload.device_id)]);
    
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.emit("device-unpaired", payload.device_id.clone());
    }

    Json("ok")
}

async fn handle_pair_post(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<PairRequest>,
) -> Json<PairResponse> {
    let mut locked_code = state.pairing_code.lock().unwrap();
    if let Some(expected_code) = locked_code.as_ref() {
        if expected_code == &payload.code {
            // Code matches! Clear the code so it can't be used again
            *locked_code = None;
            
            let device_label = payload.device_name.unwrap_or_else(|| "Mobile Device".to_string());

            let auth_token = uuid::Uuid::new_v4().to_string();

            // Save paired device ID and name
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
                params![&format!("paired_{}", payload.device_id), &device_label],
            ).unwrap();
            
            conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
                params![&format!("auth_token_{}", payload.device_id), &auth_token],
            ).unwrap();
            
            // Notify frontend
            if let Some(window) = state.app_handle.get_webview_window("main") {
                let _ = window.emit("device-paired", device_label);
            }

            return Json(PairResponse {
                success: true,
                device_id: Some(state.device_id.clone()),
                device_name: Some(get_desktop_device_name()),
                auth_token: Some(auth_token),
            });
        }
    }
    
    Json(PairResponse {
        success: false,
        device_id: None,
        device_name: None,
        auth_token: None,
    })
}

async fn handle_get_file(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl axum::response::IntoResponse {
    {
        let conn = state.db.lock().unwrap();
        if !is_authenticated(&conn, &headers, addr) {
            return axum::response::Response::builder()
                .status(403)
                .body(axum::body::Body::from("forbidden"))
                .unwrap();
        }
        let is_deleted: bool = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE entity_id = ?1 AND action = 'ITEM_DELETED'",
            params![id],
            |row| row.get::<_, u64>(0),
        ).map(|c| c > 0).unwrap_or(false);

        if is_deleted {
            return axum::response::Response::builder()
                .status(404)
                .body(axum::body::Body::from("item is deleted"))
                .unwrap();
        }
    }
    
    let path = {
        let conn = state.db.lock().unwrap();
        get_file_path_for_id_existing(&state.app_handle, &conn, &id)
    };
    
    if let Some(path) = path {
        if let Ok(file) = tokio::fs::File::open(&path).await {
            let metadata = file.metadata().await.unwrap();
            let file_size = metadata.len();
            let stream = futures_util::stream::unfold(file, |mut f| async move {
                let mut buf = vec![0u8; 65536]; // 64KB chunks
                use tokio::io::AsyncReadExt;
                match f.read(&mut buf).await {
                    Ok(0) => None,
                    Ok(n) => {
                        buf.truncate(n);
                        Some((Ok::<_, std::io::Error>(axum::body::Bytes::from(buf)), f))
                    }
                    Err(e) => Some((Err(e), f)),
                }
            });
            return axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", file_size.to_string())
                .body(axum::body::Body::from_stream(stream))
                .unwrap();
        }
    }
    axum::response::Response::builder()
        .status(404)
        .body(axum::body::Body::empty())
        .unwrap()
}

async fn handle_post_file(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
    request: axum::extract::Request,
) -> impl axum::response::IntoResponse {
    let path = {
        let conn = state.db.lock().unwrap();
        if !is_authenticated(&conn, &headers, addr) {
            return axum::response::Response::builder()
                .status(403)
                .body(axum::body::Body::from("forbidden"))
                .unwrap();
        }
        get_new_file_path_for_id(&state.app_handle, &id, &conn)
    };
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    
    let mut file = match tokio::fs::File::create(&path).await {
        Ok(f) => f,
        Err(_) => {
            return axum::response::Response::builder()
                .status(500)
                .body(axum::body::Body::from("error creating file"))
                .unwrap();
        }
    };

    let mut stream = request.into_body().into_data_stream();
    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(chunk) => {
                if let Err(_) = file.write_all(&chunk).await {
                    let _ = tokio::fs::remove_file(&path).await;
                    return axum::response::Response::builder()
                        .status(500)
                        .body(axum::body::Body::from("error writing file"))
                        .unwrap();
                }
            }
            Err(_) => {
                let _ = tokio::fs::remove_file(&path).await;
                return axum::response::Response::builder()
                    .status(400)
                    .body(axum::body::Body::from("error reading body"))
                    .unwrap();
            }
        }
    }

    if let Err(_) = file.flush().await {
        return axum::response::Response::builder()
            .status(500)
            .body(axum::body::Body::from("error flushing file"))
            .unwrap();
    }

    axum::response::Response::builder()
        .status(200)
        .body(axum::body::Body::from("ok"))
        .unwrap()
}

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

async fn handle_ws(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::response::Response {
    let is_auth = {
        if addr.ip().is_loopback() {
            true
        } else {
            let conn = state.db.lock().unwrap();
            if let Some(token) = query.token {
                let count: u64 = conn.query_row(
                    "SELECT COUNT(*) FROM config WHERE key LIKE 'auth_token_%' AND value = ?1",
                    params![token],
                    |row| row.get(0),
                ).unwrap_or(0);
                count > 0
            } else {
                false
            }
        }
    };

    if !is_auth {
        return axum::response::Response::builder()
            .status(403)
            .body(axum::body::Body::from("forbidden"))
            .unwrap();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.ws_tx.subscribe();
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            client_msg = socket.recv() => {
                match client_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(window) = state.app_handle.get_webview_window("main") {
                            let _ = window.emit("mobile-message", text);
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                }
            }
        }
    }
}

#[tauri::command]
pub fn is_mobile_connected(state: tauri::State<'_, Arc<AppState>>) -> bool {
    state.ws_tx.receiver_count() > 0
}

pub fn start_p2p_server(state: Arc<AppState>) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let cors = tower_http::cors::CorsLayer::permissive();

            let app = Router::new()
                .route("/sync", get(handle_sync_get).post(handle_sync_post))
                .route("/pair", axum::routing::post(handle_pair_post))
                .route("/unpair", axum::routing::post(handle_unpair_post))
                .route("/files/:id", get(handle_get_file).post(handle_post_file))
                .route("/ws", get(handle_ws))
                .layer(cors)
                .layer(axum::extract::DefaultBodyLimit::disable())
                .with_state(state.clone());
                
            let listener = match tokio::net::TcpListener::bind("0.0.0.0:14201").await {
                Ok(l) => l,
                Err(_) => tokio::net::TcpListener::bind("0.0.0.0:0").await.unwrap(),
            };       
            let port = listener.local_addr().unwrap().port();
        let mdns = ServiceDaemon::new().unwrap();
        let service_type = "_boothub._tcp.local.";
        let instance_name = "boothub_desktop";
        let host_name = "boothub_desktop.local.";
        
        let ip = match std::net::UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => match s.connect("8.8.8.8:80") {
                Ok(()) => s.local_addr().unwrap().ip().to_string(),
                Err(_) => "127.0.0.1".to_string(),
            },
            Err(_) => "127.0.0.1".to_string(),
        };

        let properties: HashMap<String, String> = HashMap::new();
        let my_service = ServiceInfo::new(
            service_type,
            instance_name,
            host_name,
            ip,
            port,
            Some(properties),
        ).unwrap();
        
        mdns.register(my_service).unwrap();

        // Serve the Axum app
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
        });
    });
}
