use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn start_oauth_server(window: tauri::Window) {
    thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:14200") {
            Ok(l) => l,
            Err(e) => {
                println!("Failed to bind to port 14200: {}", e);
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let mut buffer = [0; 1024];
                    if let Ok(_) = stream.read(&mut buffer) {
                        let request = String::from_utf8_lossy(&buffer[..]);

                        // Parse the URL parameters to find code
                        // Format of request line: GET /oauth2redirect?code=xyz HTTP/1.1
                        let mut code = String::new();
                        if let Some(path_line) = request.lines().next() {
                            if let Some(params_start) = path_line.find("code=") {
                                let params = &path_line[params_start + 5..];
                                if let Some(end) = params.find(' ') {
                                    code = params[..end].to_string();
                                } else {
                                    code = params.to_string();
                                }

                                // Strip any other URL queries (e.g. &scope=...)
                                if let Some(amp) = code.find('&') {
                                    code = code[..amp].to_string();
                                }
                            }
                        }

                        // Respond with a success page matching the app's TUI style
                        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{}", r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BootHub Authentication</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --color-primary: #ffffff;
            --color-background: #18181b;
            --color-card: #18181b;
            --color-border: #52525b;
            --color-foreground: #fafafa;
            --color-muted: #a1a1aa;
            --color-success: #22c55e;
        }

        body {
            background-color: var(--color-background);
            color: var(--color-foreground);
            font-family: 'JetBrains Mono', monospace;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
        }

        .container {
            width: 440px;
            position: relative;
            border: 1.5px solid var(--color-primary);
            background-color: var(--color-card);
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-shadow: 6px 6px 0px rgba(255, 255, 255, 0.1);
        }

        .legend {
            position: absolute;
            top: -10px;
            left: 16px;
            padding: 0 8px;
            background-color: var(--color-card);
            font-weight: bold;
            font-size: 12px;
            color: var(--color-primary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="legend">[ Success ]</div>
        
        <div style="font-size: 13px; line-height: 1.6; text-align: center; padding: 20px 0; color: var(--color-foreground);">
            Google Drive connected successfully!<br>
            You can now close this tab and return to BootHub.
        </div>
    </div>
</body>
</html>"#);

                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();

                        if !code.is_empty() {
                            // Send code to frontend via Tauri event
                            let _ = window.emit("oauth-code", code);
                            break; // Stop listening after we capture the code!
                        }
                    }
                }
                Err(e) => {
                    println!("Error accepting connection: {}", e);
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Open BootHub", true, None::<&str>)?;
            let sync_i = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)?;
            let is_autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_i = CheckMenuItem::with_id(
                app,
                "autostart",
                "Run when my computer starts",
                true,
                is_autostart_enabled,
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Close BootHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &sync_i, &autostart_i, &quit_i])?;

            let autostart_i_clone = autostart_i.clone();

            let mut tray_builder = TrayIconBuilder::new().menu(&menu);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            } else {
                let icon_bytes = include_bytes!("../icons/32x32.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    tray_builder = tray_builder.icon(icon);
                }
            }

            let _tray = tray_builder
                .on_menu_event(
                    move |app: &tauri::AppHandle, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "sync" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-sync", ());
                            }
                        }
                        "autostart" => {
                            let current_state =
                                app.autolaunch().is_enabled().unwrap_or_else(|_| {
                                    autostart_i_clone.is_checked().unwrap_or(false)
                                });
                            let new_state = !current_state;
                            let res = if new_state {
                                app.autolaunch().enable()
                            } else {
                                app.autolaunch().disable()
                            };
                            let _ = autostart_i_clone.set_checked(new_state);
                            if let Err(e) = res {
                                println!("Failed to set autostart to {}: {:?}", new_state, e);
                            }
                        }
                        _ => {}
                    },
                )
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, start_oauth_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
