use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Emitter;
use uuid::Uuid;

const EVENT_COMPLETED: &str = "video-capture://completed";
const MIN_FPS: u32 = 1;
const MAX_FPS: u32 = 60;
const MIN_WIDTH: u32 = 320;
const MAX_WIDTH: u32 = 3840;
const MIN_HEIGHT: u32 = 240;
const MAX_HEIGHT: u32 = 2160;
const COMMON_FFMPEG_PATHS: [&str; 5] = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/bin/ffmpeg",
];

static SESSIONS: OnceLock<Mutex<HashMap<String, CaptureSession>>> = OnceLock::new();

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureComposition {
    #[serde(rename = "camera")]
    Camera,
    #[serde(rename = "screen")]
    Screen,
    #[serde(rename = "screen+camera")]
    ScreenCamera,
    #[serde(rename = "screen+camera+mic")]
    ScreenCameraMic,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeleprompterState {
    pub enabled: bool,
    pub wpm: Option<u32>,
    pub mirror: Option<bool>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOpts {
    pub project_id: String,
    pub workspace_root: String,
    pub camera_device: Option<String>,
    pub screen_device: Option<String>,
    pub mic_device: Option<String>,
    pub fps: u32,
    pub resolution: CaptureResolution,
    pub composition: CaptureComposition,
    pub teleprompter: Option<TeleprompterState>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevice {
    pub id: String,
    pub label: String,
    pub kind: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevices {
    pub cameras: Vec<CaptureDevice>,
    pub screens: Vec<CaptureDevice>,
    pub mics: Vec<CaptureDevice>,
    pub native_available: bool,
    pub unavailable_reason: Option<String>,
    pub supported_compositions: Vec<CaptureComposition>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartResult {
    pub capture_id: String,
    pub session_id: String,
    pub output_path: String,
    pub composition: CaptureComposition,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub capture_id: String,
    pub session_id: String,
    pub status: String,
    pub elapsed_ms: u64,
    pub peak_db: Option<f32>,
    pub dropped_frames: u32,
    pub output_path: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStopResult {
    pub capture_id: String,
    pub session_id: String,
    pub output_path: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug)]
struct PreparedCapture {
    capture_id: String,
    session_id: String,
    output_path: PathBuf,
    ffmpeg_path: String,
    args: Vec<String>,
    composition: CaptureComposition,
}

#[derive(Debug)]
struct CaptureSession {
    capture_id: String,
    child: Child,
    output_path: PathBuf,
    started_at: Instant,
    paused: bool,
}

#[tauri::command]
pub fn list_capture_devices() -> CaptureDevices {
    list_capture_devices_impl()
}

#[tauri::command]
pub fn start_capture(opts: CaptureOpts) -> Result<CaptureStartResult, String> {
    let prepared = prepare_capture(opts)?;
    let mut command = Command::new(&prepared.ffmpeg_path);
    command
        .args(&prepared.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|err| format!("Failed to start capture recorder: {err}"))?;
    let session = CaptureSession {
        capture_id: prepared.capture_id.clone(),
        child,
        output_path: prepared.output_path.clone(),
        started_at: Instant::now(),
        paused: false,
    };
    sessions()
        .lock()
        .map_err(|_| "Capture session lock poisoned".to_string())?
        .insert(prepared.session_id.clone(), session);

    Ok(CaptureStartResult {
        capture_id: prepared.capture_id,
        session_id: prepared.session_id,
        output_path: path_to_string(&prepared.output_path),
        composition: prepared.composition,
    })
}

#[tauri::command]
pub fn pause_capture(session_id: String) -> Result<CaptureStatus, String> {
    validate_session_id(&session_id)?;
    let mut guard = sessions()
        .lock()
        .map_err(|_| "Capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or_else(|| "Capture session not found".to_string())?;
    if !session.paused {
        signal_process(session.child.id(), "-STOP")?;
        session.paused = true;
    }
    Ok(status_for_session(&session_id, session))
}

#[tauri::command]
pub fn resume_capture(session_id: String) -> Result<CaptureStatus, String> {
    validate_session_id(&session_id)?;
    let mut guard = sessions()
        .lock()
        .map_err(|_| "Capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or_else(|| "Capture session not found".to_string())?;
    if session.paused {
        signal_process(session.child.id(), "-CONT")?;
        session.paused = false;
    }
    Ok(status_for_session(&session_id, session))
}

#[tauri::command]
pub async fn stop_capture(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<CaptureStopResult, String> {
    validate_session_id(&session_id)?;
    let mut session = sessions()
        .lock()
        .map_err(|_| "Capture session lock poisoned".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "Capture session not found".to_string())?;

    if let Some(stdin) = session.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let (session, status) = tauri::async_runtime::spawn_blocking(move || {
        let status = wait_for_stop(&mut session.child);
        (session, status)
    })
    .await
    .map_err(|err| format!("Failed to stop capture recorder: {err}"))?;
    let result = CaptureStopResult {
        capture_id: session.capture_id,
        session_id,
        output_path: path_to_string(&session.output_path),
        exit_code: status,
    };
    let _ = app.emit(EVENT_COMPLETED, &result);
    Ok(result)
}

#[tauri::command]
pub fn capture_status(session_id: String) -> Result<CaptureStatus, String> {
    validate_session_id(&session_id)?;
    let mut guard = sessions()
        .lock()
        .map_err(|_| "Capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or_else(|| "Capture session not found".to_string())?;
    Ok(status_for_session(&session_id, session))
}

fn sessions() -> &'static Mutex<HashMap<String, CaptureSession>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn list_capture_devices_impl() -> CaptureDevices {
    let ffmpeg = match resolve_ffmpeg_path() {
        Ok(path) => path,
        Err(err) => return unavailable_devices(err),
    };

    #[cfg(target_os = "macos")]
    {
        match list_macos_devices(&ffmpeg) {
            Ok(devices) => devices,
            Err(err) => unavailable_devices(err),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = ffmpeg;
        unavailable_devices(
            "Native capture is currently implemented for macOS only; use browser camera fallback."
                .to_string(),
        )
    }
}

#[cfg(target_os = "macos")]
fn list_macos_devices(ffmpeg: &str) -> Result<CaptureDevices, String> {
    let output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-f",
            "avfoundation",
            "-list_devices",
            "true",
            "-i",
            "",
        ])
        .output()
        .map_err(|err| format!("Failed to inspect capture devices: {err}"))?;
    let text = String::from_utf8_lossy(&output.stderr);
    let mut section = "";
    let mut cameras = Vec::new();
    let mut screens = Vec::new();
    let mut mics = Vec::new();

    for line in text.lines() {
        if line.contains("AVFoundation video devices") {
            section = "video";
            continue;
        }
        if line.contains("AVFoundation audio devices") {
            section = "audio";
            continue;
        }
        let Some((id, label)) = parse_avfoundation_device(line) else {
            continue;
        };
        match section {
            "video" if label.to_ascii_lowercase().contains("capture screen") => {
                screens.push(CaptureDevice {
                    id,
                    label,
                    kind: "screen".to_string(),
                });
            }
            "video" => cameras.push(CaptureDevice {
                id,
                label,
                kind: "camera".to_string(),
            }),
            "audio" => mics.push(CaptureDevice {
                id,
                label,
                kind: "mic".to_string(),
            }),
            _ => {}
        }
    }

    Ok(CaptureDevices {
        cameras,
        screens,
        mics,
        native_available: true,
        unavailable_reason: None,
        supported_compositions: vec![
            CaptureComposition::Camera,
            CaptureComposition::Screen,
            CaptureComposition::ScreenCamera,
            CaptureComposition::ScreenCameraMic,
        ],
    })
}

fn unavailable_devices(reason: String) -> CaptureDevices {
    CaptureDevices {
        cameras: Vec::new(),
        screens: Vec::new(),
        mics: Vec::new(),
        native_available: false,
        unavailable_reason: Some(reason),
        supported_compositions: Vec::new(),
    }
}

fn prepare_capture(opts: CaptureOpts) -> Result<PreparedCapture, String> {
    validate_capture_opts(&opts)?;
    let session_id = Uuid::new_v4().to_string();
    let capture_id = Uuid::new_v4().to_string();
    let output_path = capture_output_path(&opts.workspace_root, &opts.project_id, &session_id)?;
    let ffmpeg_path = resolve_ffmpeg_path()?;
    let args = build_ffmpeg_args(&opts, &output_path)?;

    Ok(PreparedCapture {
        capture_id,
        session_id,
        output_path,
        ffmpeg_path,
        args,
        composition: opts.composition,
    })
}

fn validate_capture_opts(opts: &CaptureOpts) -> Result<(), String> {
    validate_project_id(&opts.project_id)?;
    validate_workspace_root(&opts.workspace_root)?;
    validate_resolution(&opts.resolution)?;
    if opts.fps < MIN_FPS || opts.fps > MAX_FPS {
        return Err(format!("fps must be between {MIN_FPS} and {MAX_FPS}"));
    }
    validate_device_id(opts.camera_device.as_deref(), "camera_device")?;
    validate_device_id(opts.screen_device.as_deref(), "screen_device")?;
    validate_device_id(opts.mic_device.as_deref(), "mic_device")?;
    match opts.composition {
        CaptureComposition::Camera if opts.camera_device.is_none() => {
            Err("camera_device is required for camera capture".to_string())
        }
        CaptureComposition::Screen if opts.screen_device.is_none() => {
            Err("screen_device is required for screen capture".to_string())
        }
        CaptureComposition::ScreenCamera
            if opts.screen_device.is_none() || opts.camera_device.is_none() =>
        {
            Err("screen_device and camera_device are required for screen+camera capture".to_string())
        }
        CaptureComposition::ScreenCameraMic
            if opts.screen_device.is_none()
                || opts.camera_device.is_none()
                || opts.mic_device.is_none() =>
        {
            Err(
                "screen_device, camera_device, and mic_device are required for screen+camera+mic capture"
                    .to_string(),
            )
        }
        _ => Ok(()),
    }?;
    if let Some(teleprompter) = &opts.teleprompter {
        if let Some(wpm) = teleprompter.wpm {
            if !(80..=250).contains(&wpm) {
                return Err("teleprompter wpm must be between 80 and 250".to_string());
            }
        }
        let _ = teleprompter.enabled;
        let _ = teleprompter.mirror;
    }
    Ok(())
}

fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty() || project_id.len() > 120 {
        return Err("project_id must be 1-120 characters".to_string());
    }
    if !project_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("project_id may only contain ASCII letters, numbers, '-' and '_'".to_string());
    }
    Ok(())
}

fn validate_workspace_root(workspace_root: &str) -> Result<(), String> {
    if workspace_root.trim() != workspace_root || workspace_root.is_empty() {
        return Err(
            "workspace_root is required and must not have surrounding whitespace".to_string(),
        );
    }
    if workspace_root.chars().any(char::is_control) {
        return Err("workspace_root must not contain control characters".to_string());
    }
    let path = Path::new(workspace_root);
    if !path.is_absolute() {
        return Err("workspace_root must be absolute".to_string());
    }
    Ok(())
}

fn validate_resolution(resolution: &CaptureResolution) -> Result<(), String> {
    if resolution.width < MIN_WIDTH || resolution.width > MAX_WIDTH {
        return Err(format!(
            "resolution.width must be between {MIN_WIDTH} and {MAX_WIDTH}"
        ));
    }
    if resolution.height < MIN_HEIGHT || resolution.height > MAX_HEIGHT {
        return Err(format!(
            "resolution.height must be between {MIN_HEIGHT} and {MAX_HEIGHT}"
        ));
    }
    Ok(())
}

fn validate_device_id(device_id: Option<&str>, field: &str) -> Result<(), String> {
    let Some(value) = device_id else {
        return Ok(());
    };
    if value.is_empty() || value.len() > 120 || value.trim() != value {
        return Err(format!(
            "{field} must be 1-120 characters without surrounding whitespace"
        ));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ' '))
    {
        return Err(format!(
            "{field} contains unsupported characters; use the listed device id"
        ));
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if Uuid::parse_str(session_id).is_ok() {
        Ok(())
    } else {
        Err("session_id must be a UUID".to_string())
    }
}

fn capture_output_path(
    workspace_root: &str,
    project_id: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    let root = PathBuf::from(workspace_root);
    let root = fs::canonicalize(root).map_err(|err| format!("Invalid workspace root: {err}"))?;
    if !root.is_dir() {
        return Err("workspace_root must be an existing directory".to_string());
    }
    let capture_dir = root
        .join(".neuma")
        .join("video")
        .join(project_id)
        .join("captures");
    fs::create_dir_all(&capture_dir)
        .map_err(|err| format!("Failed to create capture directory: {err}"))?;
    let capture_dir =
        fs::canonicalize(capture_dir).map_err(|err| format!("Invalid capture directory: {err}"))?;
    if !capture_dir.starts_with(&root) {
        return Err("Capture directory escaped workspace root".to_string());
    }
    Ok(capture_dir.join(format!("{session_id}.mp4")))
}

fn resolve_ffmpeg_path() -> Result<String, String> {
    if let Ok(path) = std::env::var("NEUMA_CAPTURE_FFMPEG_PATH") {
        validate_ffmpeg_path(&path)?;
        return Ok(path);
    }
    for candidate in ffmpeg_candidate_paths() {
        if ffmpeg_version_check(&candidate) {
            return Ok(candidate);
        }
    }
    Err(
        "FFmpeg not found. Install FFmpeg, or set NEUMA_CAPTURE_FFMPEG_PATH to an absolute ffmpeg path."
            .to_string(),
    )
}

fn ffmpeg_candidate_paths() -> Vec<String> {
    let mut candidates = vec!["ffmpeg".to_string()];
    for path in COMMON_FFMPEG_PATHS {
        candidates.push(path.to_string());
    }
    candidates
}

fn ffmpeg_version_check(path: &str) -> bool {
    Command::new(path)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn validate_ffmpeg_path(path: &str) -> Result<(), String> {
    if path.trim() != path || path.is_empty() || path.chars().any(char::is_control) {
        return Err("NEUMA_CAPTURE_FFMPEG_PATH is invalid".to_string());
    }
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("NEUMA_CAPTURE_FFMPEG_PATH must be absolute".to_string());
    }
    if !path.is_file() {
        return Err("NEUMA_CAPTURE_FFMPEG_PATH must point to an executable file".to_string());
    }
    Ok(())
}

fn build_ffmpeg_args(opts: &CaptureOpts, output_path: &Path) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        build_macos_ffmpeg_args(opts, output_path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (opts, output_path);
        Err("Native capture is currently implemented for macOS only".to_string())
    }
}

fn build_macos_ffmpeg_args(opts: &CaptureOpts, output_path: &Path) -> Result<Vec<String>, String> {
    let output = path_to_string(output_path);
    let fps = opts.fps.to_string();
    let size = format!("{}x{}", opts.resolution.width, opts.resolution.height);
    let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];

    match opts.composition {
        CaptureComposition::Camera => {
            let input =
                avfoundation_input(opts.camera_device.as_deref(), opts.mic_device.as_deref())?;
            args.extend([
                "-f".to_string(),
                "avfoundation".to_string(),
                "-framerate".to_string(),
                fps,
                "-video_size".to_string(),
                size,
                "-i".to_string(),
                input,
            ]);
        }
        CaptureComposition::Screen => {
            let input =
                avfoundation_input(opts.screen_device.as_deref(), opts.mic_device.as_deref())?;
            args.extend([
                "-f".to_string(),
                "avfoundation".to_string(),
                "-framerate".to_string(),
                fps,
                "-i".to_string(),
                input,
            ]);
        }
        CaptureComposition::ScreenCamera | CaptureComposition::ScreenCameraMic => {
            let screen = avfoundation_input(opts.screen_device.as_deref(), None)?;
            let camera =
                avfoundation_input(opts.camera_device.as_deref(), opts.mic_device.as_deref())?;
            let pip_width = (opts.resolution.width / 4).max(320).to_string();
            args.extend([
                "-f".to_string(),
                "avfoundation".to_string(),
                "-framerate".to_string(),
                opts.fps.to_string(),
                "-i".to_string(),
                screen,
                "-f".to_string(),
                "avfoundation".to_string(),
                "-framerate".to_string(),
                opts.fps.to_string(),
                "-video_size".to_string(),
                size,
                "-i".to_string(),
                camera,
                "-filter_complex".to_string(),
                format!("[1:v]scale={pip_width}:-2[pip];[0:v][pip]overlay=W-w-32:H-h-32[v]"),
                "-map".to_string(),
                "[v]".to_string(),
                "-map".to_string(),
                "1:a?".to_string(),
            ]);
        }
    }

    args.extend([
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output,
    ]);
    Ok(args)
}

fn avfoundation_input(video: Option<&str>, audio: Option<&str>) -> Result<String, String> {
    let video = video.ok_or_else(|| "video device id required".to_string())?;
    Ok(match audio {
        Some(audio) => format!("{video}:{audio}"),
        None => video.to_string(),
    })
}

fn parse_avfoundation_device(line: &str) -> Option<(String, String)> {
    let marker = line.rfind('[')?;
    let rest = line.get(marker + 1..)?;
    let close = rest.find(']')?;
    let id = rest.get(..close)?.trim();
    let label = rest.get(close + 1..)?.trim();
    if id.is_empty() || label.is_empty() || !id.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some((id.to_string(), label.to_string()))
}

fn status_for_session(session_id: &str, session: &mut CaptureSession) -> CaptureStatus {
    let status = match session.child.try_wait() {
        Ok(Some(_)) => "done",
        Ok(None) if session.paused => "paused",
        Ok(None) => "running",
        Err(_) => "unknown",
    }
    .to_string();
    CaptureStatus {
        capture_id: session.capture_id.clone(),
        session_id: session_id.to_string(),
        status,
        elapsed_ms: session.started_at.elapsed().as_millis() as u64,
        peak_db: None,
        dropped_frames: 0,
        output_path: path_to_string(&session.output_path),
    }
}

fn wait_for_stop(child: &mut Child) -> Option<i32> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                return child.wait().ok().and_then(|status| status.code());
            }
            Err(_) => {
                let _ = child.kill();
                return None;
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn signal_process(pid: u32, signal: &str) -> Result<(), String> {
    let status = Command::new("kill")
        .args([signal, &pid.to_string()])
        .status()
        .map_err(|err| format!("Failed to signal capture process: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to signal capture process with {signal}"))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn signal_process(_pid: u32, _signal: &str) -> Result<(), String> {
    Err("Pause/resume is not supported on this platform yet".to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_opts() -> CaptureOpts {
        CaptureOpts {
            project_id: "project-123".to_string(),
            workspace_root: std::env::temp_dir().to_string_lossy().to_string(),
            camera_device: Some("0".to_string()),
            screen_device: Some("1".to_string()),
            mic_device: Some("2".to_string()),
            fps: 30,
            resolution: CaptureResolution {
                width: 1920,
                height: 1080,
            },
            composition: CaptureComposition::ScreenCameraMic,
            teleprompter: Some(TeleprompterState {
                enabled: true,
                wpm: Some(150),
                mirror: Some(false),
            }),
        }
    }

    #[test]
    fn validates_safe_project_ids() {
        assert!(validate_project_id("abc-123_DEF").is_ok());
        assert!(validate_project_id("../escape").is_err());
        assert!(validate_project_id("abc/def").is_err());
        assert!(validate_project_id("").is_err());
    }

    #[test]
    fn validates_device_ids_without_shell_semantics() {
        assert!(validate_device_id(Some("FaceTime HD"), "camera_device").is_ok());
        assert!(validate_device_id(Some("0; rm -rf /"), "camera_device").is_err());
        assert!(validate_device_id(Some("0\n1"), "camera_device").is_err());
        assert!(validate_device_id(Some(" 0"), "camera_device").is_err());
    }

    #[test]
    fn requires_devices_for_screen_camera_mic() {
        let mut opts = valid_opts();
        opts.mic_device = None;
        assert!(validate_capture_opts(&opts).is_err());
    }

    #[test]
    fn capture_output_path_stays_under_workspace() {
        let root = std::env::temp_dir().join(format!("neuma-capture-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create workspace root");
        let path = capture_output_path(
            root.to_str().unwrap(),
            "project-123",
            &Uuid::new_v4().to_string(),
        )
        .expect("capture path");
        let canonical_root = fs::canonicalize(&root).expect("canonical root");
        assert!(path.starts_with(
            canonical_root
                .join(".neuma")
                .join("video")
                .join("project-123")
        ));
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("mp4")
        );
    }

    #[test]
    fn builds_screen_camera_mic_as_argument_array() {
        let opts = valid_opts();
        let args = build_macos_ffmpeg_args(&opts, Path::new("/tmp/out.mp4")).expect("args");
        assert!(args.iter().any(|arg| arg == "-filter_complex"));
        assert!(args.iter().any(|arg| arg == "1:a?"));
        assert!(args.iter().all(|arg| !arg.contains("rm -rf")));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/out.mp4"));
    }

    #[test]
    fn searches_homebrew_ffmpeg_paths_after_path_lookup() {
        let candidates = ffmpeg_candidate_paths();
        assert_eq!(candidates.first().map(String::as_str), Some("ffmpeg"));
        assert!(candidates
            .iter()
            .any(|path| path == "/opt/homebrew/bin/ffmpeg"));
        assert!(candidates
            .iter()
            .any(|path| path == "/usr/local/bin/ffmpeg"));
    }

    #[test]
    fn parses_avfoundation_device_lines() {
        let parsed =
            parse_avfoundation_device("[AVFoundation indev @ 0x123] [2] FaceTime HD Camera")
                .expect("device");
        assert_eq!(parsed.0, "2");
        assert_eq!(parsed.1, "FaceTime HD Camera");
    }
}
