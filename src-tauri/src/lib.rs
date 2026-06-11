use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use tauri::Emitter;

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

        .countdown-container {
            font-size: 11px;
            color: var(--color-muted);
            text-align: center;
            margin-top: 4px;
        }

        .tui-button {
            border: 1.5px solid var(--color-primary);
            background: transparent;
            color: var(--color-foreground);
            font-family: 'JetBrains Mono', monospace;
            font-weight: bold;
            text-align: center;
            font-size: 13px;
            padding: 10px;
            cursor: pointer;
            width: 100%;
            outline: none;
            transition: background-color 120ms ease, color 120ms ease;
        }

        .tui-button:hover {
            background: var(--color-primary);
            color: #000000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="legend">[ Success ]</div>
        
        <div style="font-size: 13px; line-height: 1.6; text-align: center; padding: 12px 0; color: var(--color-foreground);">
            Google Drive connected successfully!<br>
            You can now close this window and return to BootHub.
        </div>
        
        <div class="countdown-container" id="countdown-text">
            Auto-closing in 3.0s...
        </div>

        <button class="tui-button" onclick="window.close()">
            [ CLOSE WINDOW ]
        </button>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const countdownText = document.getElementById('countdown-text');
            const duration = 3000;
            const startTime = Date.now();

            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, duration - elapsed);
                const remainingSeconds = (remaining / 1000).toFixed(1);
                
                countdownText.textContent = `Auto-closing in ${remainingSeconds}s...`;

                if (remaining <= 0) {
                    clearInterval(interval);
                    countdownText.textContent = 'Auto-closing...';
                    window.close();
                }
            }, 100);
        });
    </script>
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet, start_oauth_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
