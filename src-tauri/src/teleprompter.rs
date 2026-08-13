use tauri::{Manager, WebviewUrl};

const TELEPROMPTER_WINDOW_LABEL: &str = "teleprompter";
const TELEPROMPTER_WINDOW_URL: &str = "index.html?neumaWindow=teleprompter";

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeleprompterWindowInput {
    pub title: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub always_on_top: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeleprompterWindowResult {
    pub label: String,
    pub created: bool,
}

#[tauri::command]
pub fn open_teleprompter(
    app: tauri::AppHandle,
    input: Option<TeleprompterWindowInput>,
) -> Result<TeleprompterWindowResult, String> {
    if let Some(window) = app.get_webview_window(TELEPROMPTER_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(TeleprompterWindowResult {
            label: TELEPROMPTER_WINDOW_LABEL.to_string(),
            created: false,
        });
    }

    let input = input.unwrap_or(TeleprompterWindowInput {
        title: None,
        width: None,
        height: None,
        always_on_top: None,
    });
    let title = input
        .title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Teleprompter");
    let width = input.width.unwrap_or(760.0).clamp(360.0, 1600.0);
    let height = input.height.unwrap_or(520.0).clamp(240.0, 1200.0);
    let always_on_top = input.always_on_top.unwrap_or(true);

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        TELEPROMPTER_WINDOW_LABEL,
        WebviewUrl::App(TELEPROMPTER_WINDOW_URL.into()),
    )
    .title(title)
    .inner_size(width, height)
    .min_inner_size(360.0, 240.0)
    .resizable(true)
    .always_on_top(always_on_top)
    .visible(true)
    .build()
    .map_err(|err| err.to_string())?;
    let _ = window.set_focus();

    Ok(TeleprompterWindowResult {
        label: TELEPROMPTER_WINDOW_LABEL.to_string(),
        created: true,
    })
}

#[tauri::command]
pub fn close_teleprompter(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TELEPROMPTER_WINDOW_LABEL) {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}
