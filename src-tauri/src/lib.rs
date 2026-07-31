mod sync_engine;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;


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
            let state = sync_engine::init_db(app.handle());
            app.manage(state.clone());
            sync_engine::start_p2p_server(state);

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
        .invoke_handler(tauri::generate_handler![
            sync_engine::generate_pairing_code,
            sync_engine::get_items,
            sync_engine::add_item,
            sync_engine::delete_item,
            sync_engine::update_item,
            sync_engine::set_item_folder,
            sync_engine::save_file,
            sync_engine::read_file,
            sync_engine::delete_file,
            sync_engine::disconnect,
            sync_engine::is_mobile_connected
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
