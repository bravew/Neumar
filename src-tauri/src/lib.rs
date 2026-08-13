use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
use tauri_plugin_sql::{Migration, MigrationKind};

mod capture;
mod daemon;
mod teleprompter;
mod workspace_watcher;
use workspace_watcher::WorkspaceWatcher;

const PRINT_READY_MESSAGE: &str = "neuma:print-ready";
const PRINT_FALLBACK_MS: u64 = 1200;
const PRINT_CLEANUP_MS: u64 = 1000;
const MAX_PRINT_HTML_BYTES: usize = 20 * 1024 * 1024;
const PDF_READY_TIMEOUT_MS: u64 = 10_000;
const PDF_CAPTURE_TIMEOUT_MS: u64 = 15_000;
static PRINT_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Show the main window and activate the application (bring to front).
/// On macOS, `window.show()` alone doesn't make the app frontmost —
/// we must also call `NSApplication.activate()`.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        // Tray events run on the main thread, so this always succeeds
        if let Some(mtm) = MainThreadMarker::new() {
            let ns_app = NSApplication::sharedApplication(mtm);
            #[allow(deprecated)]
            ns_app.activateIgnoringOtherApps(true);
        }
    }
}

/// Ensure the log directory exists and return the sidecar log file path.
/// Logs are written to ~/.neumar/logs/sidecar-MM-DD.log so that sidecar
/// output (including crashes before the Node logger initialises) is always
/// persisted to disk.
#[cfg(not(debug_assertions))]
fn get_sidecar_log_path() -> Option<std::path::PathBuf> {
    use std::time::SystemTime;

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let log_dir = std::path::Path::new(&home).join(".neumar").join("logs");
    std::fs::create_dir_all(&log_dir).ok()?;

    // Compute MM-DD from system time (no chrono dependency)
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?;
    let secs = duration.as_secs() as i64;
    // Approximate local date — good enough for log rotation naming
    let days = secs / 86400;
    // Days since epoch → year/month/day (simplified Gregorian)
    let mut y = 1970i64;
    let mut remaining = days;
    loop {
        let year_days: i64 = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days: [i64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0usize;
    while m < 12 && remaining >= month_days[m] {
        remaining -= month_days[m];
        m += 1;
    }
    let month = m + 1;
    let day = remaining + 1;

    let filename = format!("sidecar-{:02}-{:02}.log", month, day);
    Some(log_dir.join(filename))
}

/// Append a timestamped line to the sidecar log file
#[cfg(not(debug_assertions))]
fn append_sidecar_log(path: &std::path::Path, line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        // Best-effort write; ignore errors
        let _ = writeln!(f, "{}", line);
    }
}

// Store the sidecar child process for cleanup on exit
#[cfg(not(debug_assertions))]
struct ApiSidecar(Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
const API_SIDECAR_FORWARDED_ENV_KEYS: [&str; 11] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NEUMA_FFMPEG_PATH",
    "NEUMA_FFPROBE_PATH",
    "NEUMA_FFMPEG_SEARCH_PATHS",
    "FFMPEG_PATH",
    "FFPROBE_PATH",
];

#[cfg(not(debug_assertions))]
const API_SIDECAR_UNIX_EXTRA_PATH_DIRS: [&str; 11] = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/opt/local/bin",
    "/opt/local/sbin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/home/linuxbrew/.linuxbrew/sbin",
    "/usr/bin",
    "/bin",
    "/snap/bin",
];

#[cfg(not(debug_assertions))]
const API_SIDECAR_WINDOWS_EXTRA_PATH_DIRS: [&str; 2] =
    ["C:\\ffmpeg\\bin", "C:\\ProgramData\\chocolatey\\bin"];

#[cfg(not(debug_assertions))]
fn api_sidecar_env_vars() -> Vec<(String, String)> {
    let mut env_vars: Vec<(String, String)> = API_SIDECAR_FORWARDED_ENV_KEYS
        .into_iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|value| (key.to_string(), value))
        })
        .collect();

    env_vars.push(("PATH".to_string(), api_sidecar_path_env_value()));
    env_vars
}

#[cfg(not(debug_assertions))]
fn api_sidecar_path_env_value() -> String {
    let mut entries: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(if cfg!(windows) { ';' } else { ':' })
        .filter(|entry| !entry.trim().is_empty())
        .map(ToString::to_string)
        .collect();

    let extra_path_dirs: &[&str] = if cfg!(windows) {
        &API_SIDECAR_WINDOWS_EXTRA_PATH_DIRS
    } else {
        &API_SIDECAR_UNIX_EXTRA_PATH_DIRS
    };

    for dir in extra_path_dirs {
        if !entries.iter().any(|entry| entry == dir) {
            entries.push(dir.to_string());
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        for dir in [
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/.bun/bin"),
            format!("{home}/.volta/bin"),
        ] {
            if !entries.iter().any(|entry| entry == &dir) {
                entries.push(dir);
            }
        }
    }

    entries.join(if cfg!(windows) { ";" } else { ":" })
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Dynamically grant read access to files/directories the user has just
/// selected (drag-drop or file picker).
///
/// Why: the static fs-plugin scope in `capabilities/default.json` only
/// covers a handful of roots (`$HOME/.neumar`, `$DOWNLOAD`, `$DESKTOP`,
/// `$DOCUMENT`, home recursive, temp recursive). When a user drops a file
/// from an external drive (`/Volumes/…`) or an arbitrary location, the
/// webview can't read it — Tauri v2 blocks the call with "path not allowed
/// on the configured scope". This command follows the Tauri v2 best-
/// practice of runtime scope expansion via `FsExt::fs_scope()` (see
/// https://v2.tauri.app/plugin/file-system/) so the frontend can preview
/// and read any user-chosen path without reconfiguring capabilities.
///
/// Only absolute paths are granted; directories are granted recursively
/// so contents can be enumerated. Errors on individual paths are swallowed
/// — partial success is preferable to rejecting a whole drop batch.
#[tauri::command]
fn grant_file_read_access(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let scope = app.fs_scope();
    let mut granted: Vec<String> = Vec::new();
    for raw in paths {
        let path = std::path::PathBuf::from(&raw);
        if !path.is_absolute() {
            continue;
        }
        let is_dir = std::fs::metadata(&path)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        let result = if is_dir {
            scope.allow_directory(&path, true)
        } else {
            scope.allow_file(&path)
        };
        if result.is_ok() {
            granted.push(raw);
        }
    }
    Ok(granted)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactPdfPrintInput {
    html: String,
    default_filename: String,
    title: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactPdfExportResult {
    cancelled: bool,
    path: Option<String>,
}

#[tauri::command]
fn print_artifact_pdf_input(
    app: tauri::AppHandle,
    input: ArtifactPdfPrintInput,
) -> Result<(), String> {
    if input.html.trim().is_empty() {
        return Err("PDF print input is empty".to_string());
    }
    if input.html.len() > MAX_PRINT_HTML_BYTES {
        return Err("PDF print input is too large".to_string());
    }

    let label = next_print_window_label();
    let title = input
        .title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&input.default_filename)
        .to_string();
    let html = input.html;
    let loaded = Arc::new(AtomicBool::new(false));
    let loaded_for_handler = Arc::clone(&loaded);

    tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title(title.clone())
        .visible(false)
        .on_page_load(move |window, payload| {
            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                return;
            }
            if loaded_for_handler.swap(true, Ordering::SeqCst) {
                return;
            }

            let html_json = match serde_json::to_string(&html) {
                Ok(value) => value,
                Err(_) => return,
            };
            let title_json = match serde_json::to_string(&title) {
                Ok(value) => value,
                Err(_) => return,
            };
            let script = format!(
                r#"
(() => {{
  const html = {html_json};
  const title = {title_json};
  const readyMessage = {ready_message_json};
  const fallbackMs = {fallback_ms};
  const cleanupMs = {cleanup_ms};
  let printed = false;
  const triggerPrint = () => {{
    if (printed) return;
    printed = true;
    setTimeout(() => {{
      try {{
        document.title = title;
        window.focus();
        window.print();
      }} finally {{
        setTimeout(() => window.close(), cleanupMs);
      }}
    }}, 0);
  }};
  document.title = title;
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'border:0;width:100vw;height:100vh;display:block;';
  frame.srcdoc = html;
  frame.addEventListener('load', triggerPrint);
  document.body.appendChild(frame);
  window.addEventListener('message', (event) => {{
    if (event.data === readyMessage) triggerPrint();
  }});
  setTimeout(triggerPrint, fallbackMs);
}})();
"#,
                html_json = html_json,
                title_json = title_json,
                ready_message_json = serde_json::to_string(PRINT_READY_MESSAGE)
                    .unwrap_or_else(|_| { "\"neuma:print-ready\"".to_string() }),
                fallback_ms = PRINT_FALLBACK_MS,
                cleanup_ms = PRINT_CLEANUP_MS,
            );
            let _ = window.eval(script);
        })
        .build()
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn export_artifact_pdf_input(
    app: tauri::AppHandle,
    input: ArtifactPdfPrintInput,
) -> Result<ArtifactPdfExportResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, input);
        return Err(
            "Byte-level PDF export is only available on macOS; falling back to print".to_string(),
        );
    }

    #[cfg(target_os = "macos")]
    {
        if input.html.trim().is_empty() {
            return Err("PDF export input is empty".to_string());
        }
        if input.html.len() > MAX_PRINT_HTML_BYTES {
            return Err("PDF export input is too large".to_string());
        }

        let filename = ensure_pdf_extension(&input.default_filename);
        let path = match app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_file_name(filename)
            .blocking_save_file()
        {
            Some(path) => path
                .into_path()
                .map_err(|_| "Selected PDF export path is not a local file".to_string())?,
            None => {
                return Ok(ArtifactPdfExportResult {
                    cancelled: true,
                    path: None,
                });
            }
        };

        export_artifact_pdf_input_macos(app, input, path)
    }
}

#[cfg(target_os = "macos")]
fn export_artifact_pdf_input_macos(
    app: tauri::AppHandle,
    input: ArtifactPdfPrintInput,
    path: PathBuf,
) -> Result<ArtifactPdfExportResult, String> {
    use std::thread;
    use std::time::{Duration, Instant};

    let label = next_print_window_label();
    let title = input
        .title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&input.default_filename)
        .to_string();
    let ready_title = format!("{title} [neuma-pdf-ready-{label}]");
    let html = input.html;
    let loaded = Arc::new(AtomicBool::new(false));
    let loaded_for_handler = Arc::clone(&loaded);
    let ready_title_for_handler = ready_title.clone();

    let window =
        tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title(title.clone())
            .visible(false)
            .on_page_load(move |window, payload| {
                if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    return;
                }
                if loaded_for_handler.swap(true, Ordering::SeqCst) {
                    return;
                }

                let html_json = match serde_json::to_string(&html) {
                    Ok(value) => value,
                    Err(_) => return,
                };
                let title_json = match serde_json::to_string(&title) {
                    Ok(value) => value,
                    Err(_) => return,
                };
                let ready_title_json = match serde_json::to_string(&ready_title_for_handler) {
                    Ok(value) => value,
                    Err(_) => return,
                };
                let script = format!(
                    r#"
(() => {{
  const html = {html_json};
  const title = {title_json};
  const readyTitle = {ready_title_json};
  const readyMessage = {ready_message_json};
  const fallbackMs = {fallback_ms};
  let markedReady = false;
  const markReady = () => {{
    if (markedReady) return;
    markedReady = true;
    document.title = readyTitle;
  }};
  document.title = title;
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'border:0;width:100vw;height:100vh;display:block;';
  frame.srcdoc = html;
  frame.addEventListener('load', markReady);
  document.body.appendChild(frame);
  window.addEventListener('message', (event) => {{
    if (event.data === readyMessage) markReady();
  }});
  setTimeout(markReady, fallbackMs);
}})();
"#,
                    html_json = html_json,
                    title_json = title_json,
                    ready_title_json = ready_title_json,
                    ready_message_json = serde_json::to_string(PRINT_READY_MESSAGE)
                        .unwrap_or_else(|_| { "\"neuma:print-ready\"".to_string() }),
                    fallback_ms = PRINT_FALLBACK_MS,
                );
                let _ = window.eval(script);
            })
            .build()
            .map_err(|err| err.to_string())?;

    let deadline = Instant::now() + Duration::from_millis(PDF_READY_TIMEOUT_MS);
    while Instant::now() < deadline {
        if window
            .title()
            .map(|value| value == ready_title)
            .unwrap_or(false)
        {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    let result = capture_webview_pdf_to_path(&window, &path);
    let _ = window.close();
    result?;

    Ok(ArtifactPdfExportResult {
        cancelled: false,
        path: Some(path.to_string_lossy().to_string()),
    })
}

#[cfg(target_os = "macos")]
fn capture_webview_pdf_to_path(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    window
        .with_webview(move |webview| unsafe {
            let view: &WKWebView = &*webview.inner().cast();
            let tx = Arc::clone(&tx);
            let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err(format!("WKWebView PDF export failed: {:?}", &*error))
                } else if data.is_null() {
                    Err("WKWebView PDF export returned no data".to_string())
                } else {
                    Ok((&*data).to_vec())
                };
                if let Ok(mut slot) = tx.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(result);
                    }
                }
            });
            view.createPDFWithConfiguration_completionHandler(None, &completion);
        })
        .map_err(|err| err.to_string())?;

    let bytes = rx
        .recv_timeout(Duration::from_millis(PDF_CAPTURE_TIMEOUT_MS))
        .map_err(|_| "Timed out waiting for WKWebView PDF data".to_string())??;
    if bytes.is_empty() {
        return Err("WKWebView PDF export produced an empty file".to_string());
    }
    std::fs::write(path, bytes).map_err(|err| err.to_string())
}

fn ensure_pdf_extension(name: &str) -> String {
    let trimmed = name.trim();
    let fallback = if trimmed.is_empty() {
        "design.pdf"
    } else {
        trimmed
    };
    if fallback.to_ascii_lowercase().ends_with(".pdf") {
        fallback.to_string()
    } else {
        format!("{fallback}.pdf")
    }
}

fn next_print_window_label() -> String {
    let value = PRINT_WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("design-pdf-print-{value}")
}

// ── Geolocation ─────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct GeoLocation {
    latitude: f64,
    longitude: f64,
    accuracy: f64,
}

#[cfg(target_os = "macos")]
fn get_location_macos() -> Option<GeoLocation> {
    use objc2_core_location::CLLocationManager;

    let manager = unsafe { CLLocationManager::new() };

    // Check authorization status (instance method in objc2-core-location 0.3)
    let status = unsafe { manager.authorizationStatus() };
    // CLAuthorizationStatus wraps i32: 0 = NotDetermined, 1 = Restricted,
    // 2 = Denied, 3 = AuthorizedAlways, 4 = AuthorizedWhenInUse
    match status.0 {
        0 => {
            // Not determined — request permission. The OS dialog will show
            // asynchronously; this call returns None now, next invocation
            // will have the user's answer.
            unsafe { manager.requestWhenInUseAuthorization() };
            return None;
        }
        1 | 2 => {
            // Restricted or Denied — nothing we can do
            return None;
        }
        _ => {
            // 3 (AuthorizedAlways) or 4 (AuthorizedWhenInUse) — proceed
        }
    }

    // Read the last known location
    let location = unsafe { manager.location() };
    location.map(|loc| {
        let coord = unsafe { loc.coordinate() };
        let accuracy = unsafe { loc.horizontalAccuracy() };
        GeoLocation {
            latitude: coord.latitude,
            longitude: coord.longitude,
            accuracy,
        }
    })
}

#[tauri::command]
fn get_location() -> Option<GeoLocation> {
    #[cfg(target_os = "macos")]
    {
        get_location_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Kill any existing process on the API port before starting sidecar
#[cfg(not(debug_assertions))]
fn kill_existing_api_process(port: u16) {
    use std::process::Command;

    // On macOS/Linux, use lsof to find and kill process on port
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid in pids.lines() {
                if let Ok(pid_num) = pid.trim().parse::<i32>() {
                    println!(
                        "[API] Killing existing process on port {}: PID {}",
                        port, pid_num
                    );
                    let _ = Command::new("kill")
                        .args(["-9", &pid_num.to_string()])
                        .output();
                }
            }
        }
    }

    // On Windows, use netstat and taskkill
    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                    if let Some(pid) = line.split_whitespace().last() {
                        println!(
                            "[API] Killing existing process on port {}: PID {}",
                            port, pid
                        );
                        let _ = Command::new("taskkill").args(["/F", "/PID", pid]).output();
                    }
                }
            }
        }
    }

    // Give the OS a moment to release the port
    std::thread::sleep(std::time::Duration::from_millis(500));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single schema migration for pre-release.
    // After first public release, add incremental migrations (version 2, 3, …).
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: r#"
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY NOT NULL,
                    prompt TEXT NOT NULL,
                    task_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT,
                    task_index INTEGER DEFAULT 1,
                    prompt TEXT NOT NULL,
                    title TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    cost REAL,
                    duration INTEGER,
                    favorite INTEGER DEFAULT 0,
                    work_dir TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT,
                    tool_name TEXT,
                    tool_input TEXT,
                    tool_output TEXT,
                    tool_use_id TEXT,
                    subtype TEXT,
                    error_message TEXT,
                    attachments TEXT,
                    message_id TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    preview TEXT,
                    thumbnail TEXT,
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS media_versions (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    version_number INTEGER NOT NULL,
                    path TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    previous_version_id TEXT,
                    type TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
                CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
                CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
                CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id) WHERE message_id IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_files_task_id ON files(task_id);
                CREATE INDEX IF NOT EXISTS idx_media_versions_task_id ON media_versions(task_id);

                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY NOT NULL,
                    provider TEXT NOT NULL,
                    account_email TEXT,
                    display_name TEXT,
                    avatar_url TEXT,
                    scopes TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
                    expires_at TEXT,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider);
                CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_message_cost",
            sql: "ALTER TABLE messages ADD COLUMN cost REAL;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_message_usage_input",
            sql: "ALTER TABLE messages ADD COLUMN usage_input INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_message_usage_output",
            sql: "ALTER TABLE messages ADD COLUMN usage_output INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_message_model",
            sql: "ALTER TABLE messages ADD COLUMN model TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_message_usage_cache_read",
            sql: "ALTER TABLE messages ADD COLUMN usage_cache_read INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_message_usage_cache_creation",
            sql: "ALTER TABLE messages ADD COLUMN usage_cache_creation INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add agui_type to messages",
            sql: "ALTER TABLE messages ADD COLUMN agui_type TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add run_id to messages",
            sql: "ALTER TABLE messages ADD COLUMN run_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add step_name to messages",
            sql: "ALTER TABLE messages ADD COLUMN step_name TEXT;",
            kind: MigrationKind::Up,
        },
    ];

    #[cfg(not(debug_assertions))]
    let api_sidecar = ApiSidecar(Mutex::new(None));

    // Stronghold vault salt file lives next to the vault in ~/.neumar/
    let salt_path: PathBuf = {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".neumar").join(".stronghold_salt")
    };

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:neumar.db", migrations)
                .build(),
        );

    // Manage the sidecar state in production
    #[cfg(not(debug_assertions))]
    {
        builder = builder.manage(api_sidecar);
    }

    // Workspace watcher state — shared across the start/stop/status commands.
    builder = builder.manage(Arc::new(WorkspaceWatcher::default()));

    builder
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Hide the window instead of closing — keeps the app alive in the tray
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // ── System tray ────────────────────────────────────────────────
            let app_name = &app.package_info().name;
            let show_item = MenuItemBuilder::with_id("show", format!("Show {}", app_name)).build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", format!("Quit {}", app_name)).build(app)?;
            let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-icon@2x.png"),
            )?;
            let tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip(app_name)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => app_handle.exit(0),
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            // In development mode (tauri dev), skip sidecar and use external API server
            // Run `pnpm dev:api` separately for hot-reload support
            // In production, spawn the bundled API sidecar
            #[cfg(not(debug_assertions))]
            {
                const API_PORT: u16 = 2620;

                // Kill any existing process on the API port
                kill_existing_api_process(API_PORT);

                let resource_dir = app.path().resource_dir()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                let mut sidecar_command = app.shell().sidecar("neumar-api")
                    .unwrap()
                    .env("PORT", API_PORT.to_string())
                    .env("NODE_ENV", "production")
                    .env("RESOURCES_DIR", resource_dir);
                for (key, value) in api_sidecar_env_vars() {
                    sidecar_command = sidecar_command.env(key, value);
                }
                let (mut rx, child) = sidecar_command.spawn().expect("Failed to spawn API sidecar");

                // Store the child process for cleanup on exit
                if let Some(state) = app.try_state::<ApiSidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(child);
                    }
                }

                // Log sidecar output to both console and log file
                let sidecar_log_path = get_sidecar_log_path();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let text = String::from_utf8_lossy(&line);
                                println!("[API] {}", text);
                                if let Some(ref p) = sidecar_log_path {
                                    append_sidecar_log(p, &format!("[OUT] {}", text));
                                }
                            }
                            CommandEvent::Stderr(line) => {
                                let text = String::from_utf8_lossy(&line);
                                eprintln!("[API Error] {}", text);
                                if let Some(ref p) = sidecar_log_path {
                                    append_sidecar_log(p, &format!("[ERR] {}", text));
                                }
                            }
                            CommandEvent::Error(error) => {
                                eprintln!("[API Spawn Error] {}", error);
                                if let Some(ref p) = sidecar_log_path {
                                    append_sidecar_log(p, &format!("[SPAWN_ERROR] {}", error));
                                }
                            }
                            CommandEvent::Terminated(status) => {
                                let msg = format!("[API] Process terminated with status: {:?}", status);
                                println!("{}", msg);
                                if let Some(ref p) = sidecar_log_path {
                                    append_sidecar_log(p, &msg);
                                }
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                println!("[Tauri Dev] API sidecar disabled. Run `pnpm dev:api` for the API server on port 5126.");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_location,
            grant_file_read_access,
            export_artifact_pdf_input,
            print_artifact_pdf_input,
            workspace_watcher::start_workspace_watcher,
            workspace_watcher::stop_workspace_watcher,
            workspace_watcher::workspace_watcher_status,
            daemon::daemon_install,
            daemon::daemon_uninstall,
            daemon::daemon_status,
            daemon::daemon_kickstart,
            daemon::daemon_logs_tail,
            capture::list_capture_devices,
            capture::start_capture,
            capture::pause_capture,
            capture::resume_capture,
            capture::stop_capture,
            capture::capture_status,
            teleprompter::open_teleprompter,
            teleprompter::close_teleprompter
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Dock icon clicked on macOS (or taskbar on Windows) with no visible windows
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    if !has_visible_windows {
                        show_main_window(app_handle);
                    }
                }
                // Cleanup sidecar on exit
                tauri::RunEvent::Exit => {
                    #[cfg(not(debug_assertions))]
                    {
                        println!("[App] Cleaning up API sidecar...");
                        if let Some(state) = app_handle.try_state::<ApiSidecar>() {
                            if let Ok(mut guard) = state.0.lock() {
                                if let Some(child) = guard.take() as Option<CommandChild> {
                                    println!("[App] Killing API sidecar process...");
                                    let _ = child.kill();
                                }
                            }
                        }
                        // Also try to kill by port as a fallback
                        kill_existing_api_process(2620);
                    }
                    #[cfg(debug_assertions)]
                    {
                        let _ = app_handle;
                    }
                }
                _ => {}
            }
        });
}
