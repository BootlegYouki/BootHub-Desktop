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

    Arc::new(AppState {
        db: Mutex::new(conn),
        device_id,
        pairing_code: Mutex::new(None),
        app_handle: app.clone(),
        ws_tx,
    })
}

#[tauri::command]
pub fn generate_pairing_code(state: tauri::State<'_, Arc<AppState>>) -> String {
    use rand::Rng;
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

fn rebuild_materialized_view(conn: &Connection, entity_id: &str) {
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
        conn.execute(
            "INSERT OR REPLACE INTO items (id, type, label, value, folderId, syncState) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item.get("id").and_then(|v| v.as_str()).unwrap_or(entity_id),
                item.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"),
                item.get("label").and_then(|v| v.as_str()).unwrap_or(""),
                item.get("value").and_then(|v| v.as_str()).unwrap_or(""),
                item.get("folderId").and_then(|v| v.as_str()),
                "pending"
            ],
        ).unwrap();
    } else {
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

    rebuild_materialized_view(&conn, entity_id);
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
pub fn add_item(state: tauri::State<'_, Arc<AppState>>, id: String, r#type: String, value: String, folder_id: Option<String>) -> Result<(), String> {
    let label = chrono::Local::now().format("%m-%d-%Y @ %H:%M").to_string(); // Simplified timestamp
    
    let mut payload = serde_json::json!({
        "type": r#type,
        "label": label,
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
pub fn update_item(state: tauri::State<'_, Arc<AppState>>, id: String, value: String) -> Result<(), String> {
    append_event(&state, &id, "ITEM_UPDATED", serde_json::json!({ "value": value }));
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
    let conn = state.db.lock().unwrap();
    conn.execute("DELETE FROM config WHERE key LIKE 'paired_%'", []).map_err(|e| e.to_string())?;
    let _ = state.ws_tx.send("FORCE_DISCONNECT".to_string());
    Ok(())
}

// ─── File Storage Commands ──────────────────────────────────────────────────────

fn get_files_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let mut dir = app_handle.path().app_data_dir().unwrap();
    dir.push("files");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tauri::command]
pub fn save_file(app: tauri::AppHandle, id: String, data: Vec<u8>) -> Result<(), String> {
    let mut path = get_files_dir(&app);
    path.push(&id);
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(app: tauri::AppHandle, id: String) -> Result<Vec<u8>, String> {
    let mut path = get_files_dir(&app);
    path.push(&id);
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut path = get_files_dir(&app);
    path.push(&id);
    if path.exists() {
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

async fn handle_sync_get(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Query(query): Query<SyncQuery>,
) -> Json<SyncResponse> {
    let since = query.since.unwrap_or(0);
    let conn = state.db.lock().unwrap();
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

    Json(SyncResponse { events, max_clock })
}

async fn handle_sync_post(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<SyncPayload>,
) -> Json<&'static str> {
    let mut conn = state.db.lock().unwrap();
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
        rebuild_materialized_view(&conn, &entity);
    }
    
    let _ = state.ws_tx.send("SYNC_NEEDED".to_string());
    
    // Notify frontend of update
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.emit("storage-updated", ());
    }
    
    Json("ok")
}

#[derive(Deserialize)]
pub struct PairRequest {
    code: String,
    device_id: String,
}

#[derive(Serialize)]
pub struct PairResponse {
    success: bool,
    device_id: Option<String>,
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
            
            // Save paired device ID
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
                params![&format!("paired_{}", payload.device_id), "true"],
            ).unwrap();
            
            // Notify frontend
            if let Some(window) = state.app_handle.get_webview_window("main") {
                let _ = window.emit("device-paired", payload.device_id.clone());
            }

            return Json(PairResponse {
                success: true,
                device_id: Some(state.device_id.clone()),
            });
        }
    }
    
    Json(PairResponse {
        success: false,
        device_id: None,
    })
}

async fn handle_get_file(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl axum::response::IntoResponse {
    let mut path = get_files_dir(&state.app_handle);
    path.push(&id);
    if path.exists() {
        if let Ok(bytes) = std::fs::read(&path) {
            return axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/octet-stream")
                .body(axum::body::Body::from(bytes))
                .unwrap();
        }
    }
    axum::response::Response::builder()
        .status(404)
        .body(axum::body::Body::empty())
        .unwrap()
}

async fn handle_post_file(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
    request: axum::extract::Request,
) -> impl axum::response::IntoResponse {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut path = get_files_dir(&state.app_handle);
    path.push(&id);
    
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

async fn handle_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::response::Response {
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
                if let Some(Ok(_)) = client_msg {
                    // Ignore client messages for now
                } else {
                    break;
                }
            }
        }
    }
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
        axum::serve(listener, app).await.unwrap();
        });
    });
}
