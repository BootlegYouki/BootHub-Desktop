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

                        // Respond with a simple success page
                        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
                        <html>\
                        <head>\
                            <title>BootHub Authentication</title>\
                            <style>\
                                body {\
                                    font-family: monospace;\
                                    display: flex;\
                                    flex-direction: column;\
                                    align-items: center;\
                                    justify-content: center;\
                                    height: 100vh;\
                                    background: #09090b;\
                                    color: #a1a1aa;\
                                    margin: 0;\
                                }\
                                .container {\
                                    border: 1.5px solid #a855f7;\
                                    padding: 30px;\
                                    background: #18181b;\
                                    text-align: center;\
                                    box-shadow: 4px 4px 0px #a855f7;\
                                }\
                                h1 {\
                                    color: #a855f7;\
                                    margin-top: 0;\
                                    font-weight: bold;\
                                    letter-spacing: 1px;\
                                }\
                                p {\
                                    margin-bottom: 20px;\
                                    font-size: 14px;\
                                }\
                                .status {\
                                    color: #22c55e;\
                                    font-weight: bold;\
                                }\
                            </style>\
                        </head>\
                        <body>\
                            <div class=\"container\">\
                                <h1>BOOTLEG YOUIKI / BOOTHUB</h1>\
                                <p class=\"status\">[ AUTHENTICATION SUCCESSFUL ]</p>\
                                <p>You have successfully logged in to Google Drive.</p>\
                                <p>You can close this tab and return to the application.</p>\
                            </div>\
                            <script>window.close();</script>\
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
        .invoke_handler(tauri::generate_handler![greet, start_oauth_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
