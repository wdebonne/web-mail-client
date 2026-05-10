use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ── Commandes invocables depuis le frontend ──────────────────────────────────

/// Met à jour le tooltip du tray avec le nombre de mails non lus.
#[tauri::command]
fn update_tray_badge(app: tauri::AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if count > 0 {
            format!("WebMail — {} non lu(s)", count)
        } else {
            "WebMail".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
        // Badge textuel dans le titre (visible sur macOS + tray Windows)
        let title = if count > 0 {
            format!("({})", count)
        } else {
            String::new()
        };
        let _ = tray.set_title(Some(&title));
    }
}

/// Retourne l'état du démarrage automatique.
#[tauri::command]
async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Active ou désactive le démarrage automatique avec Windows.
#[tauri::command]
async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        // Ouvre la fenêtre existante si l'app est déjà en cours d'exécution.
        // Gère aussi la transmission des deep links reçus par la 2e instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Réémettre le deep link reçu par la 2e instance vers le frontend
            if let Some(url) = args.get(1) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tauri:deep-link", url.clone());
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ── Démarrage masqué (lancé via autostart --hidden) ──────────────
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // ── Système de tray ──────────────────────────────────────────────
            let open_i    = MenuItem::with_id(app, "open",    "Ouvrir WebMail",    true, None::<&str>)?;
            let compose_i = MenuItem::with_id(app, "compose", "✉ Nouveau message", true, None::<&str>)?;
            let sep       = PredefinedMenuItem::separator(app)?;
            let quit_i    = MenuItem::with_id(app, "quit",    "Quitter",           true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &compose_i, &sep, &quit_i])?;

            TrayIconBuilder::with_id("main")
                .tooltip("WebMail")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => std::process::exit(0),
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "compose" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("tauri:compose", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Clic gauche → afficher/masquer la fenêtre
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ── Raccourci global Ctrl+Shift+M ────────────────────────────────
            app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM),
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                },
            )?;

            // ── Deep links (mailto: / webmail://) ───────────────────────────
            use tauri_plugin_deep_link::DeepLinkExt;
            app.deep_link().on_open_url(|event| {
                // L'événement est réémis vers le frontend via useTauri.ts
                for url in event.urls() {
                    println!("[deep-link] {}", url);
                }
            });
            // Enregistrer webmail:// comme protocole custom
            let _ = app.deep_link().register("webmail");

            // ── Fermer dans le tray au lieu de quitter ───────────────────────
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_tray_badge,
            get_autostart,
            set_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WebMail");
}
