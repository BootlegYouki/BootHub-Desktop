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
                        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
                        <!DOCTYPE html>\
                        <html>\
                        <head>\
                            <title>BootHub Authentication</title>\
                            <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\
                            <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\
                            <link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap\" rel=\"stylesheet\">\
                            <style>\
                                :root {\
                                    --color-primary: #a855f7;\
                                    --color-background: #09090b;\
                                    --color-card: #18181b;\
                                    --color-border: #52525b;\
                                    --color-foreground: #f4f4f5;\
                                    --color-muted: #71717a;\
                                    --color-success: #22c55e;\
                                }\
                                body {\
                                    background-color: var(--color-background);\
                                    color: var(--color-foreground);\
                                    font-family: 'JetBrains Mono', monospace;\
                                    display: flex;\
                                    align-items: center;\
                                    justify-content: center;\
                                    height: 100vh;\
                                    margin: 0;\
                                    overflow: hidden;\
                                    background-size: 24px 24px;\
                                    background-image: \
                                        linear-gradient(to right, rgba(168, 85, 247, 0.04) 1px, transparent 1px), \
                                        linear-gradient(to bottom, rgba(168, 85, 247, 0.04) 1px, transparent 1px);\
                                }\
                                .container {\
                                    width: 440px;\
                                    position: relative;\
                                    border: 1.5px solid var(--color-primary);\
                                    background-color: var(--color-card);\
                                    padding: 24px;\
                                    display: flex;\
                                    flex-direction: column;\
                                    gap: 16px;\
                                    box-shadow: 6px 6px 0px rgba(168, 85, 247, 0.1);\
                                }\
                                .legend {\
                                    position: absolute;\
                                    top: -10px;\
                                    left: 16px;\
                                    padding: 0 8px;\
                                    background-color: var(--color-card);\
                                    font-weight: bold;\
                                    font-size: 12px;\
                                    color: var(--color-primary);\
                                    text-transform: uppercase;\
                                    letter-spacing: 0.05em;\
                                }\
                                .success-badge {\
                                    border: 1.5px dashed var(--color-success);\
                                    background: rgba(34, 197, 94, 0.05);\
                                    padding: 10px;\
                                    text-align: center;\
                                    color: var(--color-success);\
                                    font-weight: bold;\
                                    font-size: 13px;\
                                }\
                                .log-section {\
                                    border: 1.5px solid var(--color-border);\
                                    padding: 12px;\
                                    display: flex;\
                                    flex-direction: column;\
                                    gap: 6px;\
                                }\
                                .log-item {\
                                    font-size: 12px;\
                                    color: var(--color-muted);\
                                    display: flex;\
                                    gap: 8px;\
                                }\
                                .log-tag {\
                                    color: var(--color-primary);\
                                    flex-shrink: 0;\
                                }\
                                .log-msg {\
                                    color: var(--color-foreground);\
                                }\
                                .tui-button {\
                                    border: 1.5px solid var(--color-primary);\
                                    background: transparent;\
                                    color: var(--color-foreground);\
                                    font-family: 'JetBrains Mono', monospace;\
                                    font-weight: bold;\
                                    text-align: center;\
                                    font-size: 13px;\
                                    padding: 10px;\
                                    cursor: pointer;\
                                    width: 100%;\
                                    outline: none;\
                                    transition: background-color 120ms ease, color 120ms ease;\
                                }\
                                .tui-button:hover {\
                                    background: var(--color-primary);\
                                    color: #000000;\
                                }\
                                .cursor {\
                                    display: inline-block;\
                                    width: 8px;\
                                    height: 14px;\
                                    background: var(--color-foreground);\
                                    animation: blink 1s step-end infinite;\
                                    vertical-align: middle;\
                                }\
                                @keyframes blink {\
                                    from, to { background-color: transparent }\
                                    50% { background-color: var(--color-foreground) }\
                                }\
                            </style>\
                        </head>\
                        <body>\
                            <div class=\"container\">\
                                <div class=\"legend\">[ G-Drive Auth v2.0 ]</div>\
                                <div class=\"success-badge\">\
                                    STATUS: AUTHENTICATION_SUCCESS\
                                </div>\
                                <div class=\"log-section\">\
                                    <div class=\"log-item\">\
                                        <span class=\"log-tag\">[ok]</span>\
                                        <span class=\"log-msg\">TCP port 14200 handshaking...</span>\
                                    </div>\
                                    <div class=\"log-item\">\
                                        <span class=\"log-tag\">[ok]</span>\
                                        <span class=\"log-msg\">OAuth token code captured</span>\
                                    </div>\
                                    <div class=\"log-item\">\
                                        <span class=\"log-tag\">[ok]</span>\
                                        <span class=\"log-msg\">Session synchronized locally</span>\
                                    </div>\
                                    <div class=\"log-item\">\
                                        <span class=\"log-tag\">[sys]</span>\
                                        <span class=\"log-msg\" style=\"color: var(--color-muted);\">Ready to return to BootHub.<span class=\"cursor\"></span></span>\
                                    </div>\
                                </div>\
                                <button class=\"tui-button\" onclick=\"window.close()\">\
                                    [ CLOSE WINDOW ]\
                                </button>\
                            </div>\
                            <script>\
                                setTimeout(() => {\
                                    window.close();\
                                }, 3000);\
                            </script>\
                        </body>\
                        </html>";

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
