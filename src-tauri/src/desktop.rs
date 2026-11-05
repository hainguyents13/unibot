//! What makes Unibot live in the background on Windows: the tray icon and its menu, closing to the
//! tray, the attention dot, start with Windows, and notifications that open the chat they're about.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

const TRAY_ID: &str = "main";
/// The event the page listens for to open a chat: its payload is the chat's target, e.g. `bot:ops`.
pub const OPEN_EVENT: &str = "unibot://open";

/// Whether this run has said yet that closing the window keeps Unibot running.
static TOLD_ABOUT_TRAY: AtomicBool = AtomicBool::new(false);

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Unibot", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Unibot", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &autostart, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("app icon".into()))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Unibot")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "autostart" => {
                let manager = app.autolaunch();
                let on = manager.is_enabled().unwrap_or(false);
                let _ = if on {
                    manager.disable()
                } else {
                    manager.enable()
                };
                // Shows what Windows actually has, also when the change didn't take.
                let _ = autostart.set_checked(manager.is_enabled().unwrap_or(on));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Closing the main window hides it to the tray; Quit in the tray menu ends the app.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        api.prevent_close();
        let _ = window.hide();
        if !TOLD_ABOUT_TRAY.swap(true, Ordering::Relaxed) {
            let _ = show_toast(
                window.app_handle(),
                "Unibot is still running",
                "It keeps your Bots connected from the tray. Quit it from the tray menu.",
                None,
            );
        }
    }
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Marks the tray icon with a dot while a Bot needs you.
#[tauri::command]
pub fn set_attention<R: Runtime>(app: AppHandle<R>, needs_you: bool) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("no tray icon")?;
    let base = app.default_window_icon().ok_or("no app icon")?;
    let icon = if needs_you {
        with_dot(base)
    } else {
        base.clone().to_owned()
    };
    tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(if needs_you {
        "Unibot: a Bot needs you"
    } else {
        "Unibot"
    }))
    .map_err(|e| e.to_string())
}

/// Shows a Windows notification. Clicking it brings the window up on `target`'s chat.
#[tauri::command]
pub fn notify<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: String,
    target: Option<String>,
) -> Result<(), String> {
    show_toast(&app, &title, &body, target)
}

fn show_toast<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
    target: Option<String>,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;
    // An installed app is registered under its identifier; a development build has no
    // registration of its own, so it borrows PowerShell's, as Tauri's notification plugin does.
    let app_id = if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let handle = app.clone();
    Toast::new(&app_id)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            show_main(&handle);
            if let Some(target) = &target {
                let _ = handle.emit(OPEN_EVENT, target.clone());
            }
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

/// The app icon with an orange dot in its lower right corner.
fn with_dot(base: &Image<'_>) -> Image<'static> {
    let (width, height) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    paint_dot(&mut rgba, width, height);
    Image::new_owned(rgba, width, height)
}

fn paint_dot(rgba: &mut [u8], width: u32, height: u32) {
    let radius = width.min(height) as f32 * 0.22;
    let (cx, cy) = (width as f32 - radius - 1.0, height as f32 - radius - 1.0);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            if dx * dx + dy * dy <= radius * radius {
                let i = ((y * width + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[0xea, 0x58, 0x0c, 0xff]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::paint_dot;

    #[test]
    fn the_dot_sits_in_the_lower_right_and_leaves_the_rest() {
        let (w, h) = (32u32, 32u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        paint_dot(&mut rgba, w, h);
        let pixel =
            |x: u32, y: u32| &rgba[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize];
        assert_eq!(pixel(25, 25), &[0xea, 0x58, 0x0c, 0xff]);
        assert_eq!(pixel(2, 2), &[0, 0, 0, 0]);
    }
}
