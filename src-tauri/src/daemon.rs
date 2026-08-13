//! Daemon supervisor commands (Phase 6 D).
//!
//! Installs / uninstalls / inspects an OS-native supervisor that keeps the
//! neuma sidecar running while the desktop window is closed:
//!  - macOS: launchd (`~/Library/LaunchAgents/<label>.plist`)
//!  - Linux: systemd user unit (`~/.config/systemd/user/<label>.service`)
//!  - Windows: Task Scheduler (XML registered via `schtasks /Create`)
//!
//! All shell-outs use `Command::new().args([...])` arrays — never string
//! interpolation — and reject labels that don't match `[A-Za-z0-9._-]+`.

use std::path::PathBuf;
use std::process::{Command, Output};

const DEFAULT_LABEL: &str = "ai.neuma.daemon";

fn validate_label(label: &str) -> Result<(), String> {
    if label.is_empty() || label.len() > 128 {
        return Err("label must be 1..=128 chars".into());
    }
    if !label
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("label must match [A-Za-z0-9._-]+".into());
    }
    Ok(())
}

fn validate_sidecar_path(sidecar_path: &str) -> Result<(), String> {
    if sidecar_path.is_empty() {
        return Err("sidecar_path required".into());
    }
    if sidecar_path.trim() != sidecar_path {
        return Err("sidecar_path must not have leading or trailing whitespace".into());
    }
    if sidecar_path.chars().any(|c| c.is_control()) {
        return Err("sidecar_path must not contain control characters".into());
    }
    if !std::path::Path::new(sidecar_path).is_absolute() {
        return Err("sidecar_path must be absolute".into());
    }
    Ok(())
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

async fn command_output(program: &str, args: Vec<String>) -> Result<Output, String> {
    let program = program.to_string();
    tauri::async_runtime::spawn_blocking(move || Command::new(program).args(args).output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "HOME/USERPROFILE not set".into())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DaemonStatus {
    pub installed: bool,
    pub running: bool,
    pub label: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// macOS — launchd
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn plist_path(label: &str) -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{label}.plist")))
}

#[cfg(target_os = "macos")]
pub fn render_plist(label: &str, sidecar_path: &str) -> String {
    let label = escape_xml(label);
    let sidecar_path = escape_xml(sidecar_path);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{sidecar_path}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NEUMA_LAUNCHD_LABEL</key><string>{label}</string>
    <key>NEUMA_DAEMON</key><string>1</string>
  </dict>
</dict>
</plist>
"#
    )
}

#[cfg(target_os = "macos")]
async fn install_macos(label: &str, sidecar_path: &str) -> Result<(), String> {
    let plist = plist_path(label)?;
    if let Some(parent) = plist.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&plist, render_plist(label, sidecar_path)).map_err(|e| e.to_string())?;

    // SAFETY: launchctl + plist path only; never user-supplied argv strings.
    let uid = nix_uid();
    let target = format!("gui/{}", uid);
    let out = command_output(
        "launchctl",
        vec![
            "bootstrap".into(),
            target.clone(),
            plist.to_string_lossy().into_owned(),
        ],
    )
    .await?;
    if !out.status.success() {
        // bootstrap fails if already loaded — kickstart instead.
        let kick = command_output(
            "launchctl",
            vec![
                "kickstart".into(),
                "-k".into(),
                format!("gui/{}/{}", uid, label),
            ],
        )
        .await?;
        if !kick.status.success() {
            return Err(String::from_utf8_lossy(&kick.stderr).to_string());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn uninstall_macos(label: &str) -> Result<(), String> {
    let uid = nix_uid();
    let plist = plist_path(label)?;
    let _ = command_output(
        "launchctl",
        vec!["bootout".into(), format!("gui/{}/{}", uid, label)],
    )
    .await;
    if plist.exists() {
        std::fs::remove_file(&plist).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn status_macos(label: &str) -> Result<DaemonStatus, String> {
    let plist = plist_path(label)?;
    let installed = plist.exists();
    let uid = nix_uid();
    let out = command_output(
        "launchctl",
        vec!["print".into(), format!("gui/{}/{}", uid, label)],
    )
    .await?;
    let running = out.status.success();
    Ok(DaemonStatus {
        installed,
        running,
        label: label.to_string(),
        message: if running {
            "running".into()
        } else if installed {
            "installed (stopped)".into()
        } else {
            "not installed".into()
        },
    })
}

#[cfg(target_os = "macos")]
async fn kickstart_macos(label: &str) -> Result<(), String> {
    let uid = nix_uid();
    let out = command_output(
        "launchctl",
        vec![
            "kickstart".into(),
            "-k".into(),
            format!("gui/{}/{}", uid, label),
        ],
    )
    .await?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn nix_uid() -> u32 {
    // SAFETY: getuid() is always safe to call.
    unsafe { libc::getuid() }
}

// ---------------------------------------------------------------------------
// Linux — systemd user unit
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn unit_path(label: &str) -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join(".config")
        .join("systemd")
        .join("user")
        .join(format!("{label}.service")))
}

#[cfg(target_os = "linux")]
pub fn render_unit(label: &str, sidecar_path: &str) -> String {
    let sidecar_path = systemd_quote(sidecar_path);
    format!(
        r#"[Unit]
Description=Neuma agent daemon ({label})
After=network.target

[Service]
ExecStart={sidecar_path}
Environment=NEUMA_LAUNCHD_LABEL={label}
Environment=NEUMA_DAEMON=1
Restart=on-failure
RestartSec=5
StartLimitBurst=10

[Install]
WantedBy=default.target
"#
    )
}

#[cfg(target_os = "linux")]
fn systemd_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('%', "%%")
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}

#[cfg(target_os = "linux")]
async fn install_linux(label: &str, sidecar_path: &str) -> Result<(), String> {
    let path = unit_path(label)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, render_unit(label, sidecar_path)).map_err(|e| e.to_string())?;

    let _ = command_output("systemctl", vec!["--user".into(), "daemon-reload".into()]).await;
    let out = command_output(
        "systemctl",
        vec![
            "--user".into(),
            "enable".into(),
            "--now".into(),
            format!("{label}.service"),
        ],
    )
    .await?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn uninstall_linux(label: &str) -> Result<(), String> {
    let _ = command_output(
        "systemctl",
        vec![
            "--user".into(),
            "disable".into(),
            "--now".into(),
            format!("{label}.service"),
        ],
    )
    .await;
    let path = unit_path(label)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let _ = command_output("systemctl", vec!["--user".into(), "daemon-reload".into()]).await;
    Ok(())
}

#[cfg(target_os = "linux")]
async fn status_linux(label: &str) -> Result<DaemonStatus, String> {
    let path = unit_path(label)?;
    let installed = path.exists();
    let out = command_output(
        "systemctl",
        vec![
            "--user".into(),
            "is-active".into(),
            format!("{label}.service"),
        ],
    )
    .await?;
    let running = out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "active";
    Ok(DaemonStatus {
        installed,
        running,
        label: label.to_string(),
        message: String::from_utf8_lossy(&out.stdout).trim().to_string(),
    })
}

#[cfg(target_os = "linux")]
async fn kickstart_linux(label: &str) -> Result<(), String> {
    let out = command_output(
        "systemctl",
        vec![
            "--user".into(),
            "restart".into(),
            format!("{label}.service"),
        ],
    )
    .await?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows — Task Scheduler
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn render_task_xml(label: &str, sidecar_path: &str) -> String {
    let label = escape_xml(label);
    let sidecar_path = escape_xml(sidecar_path);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Neuma agent daemon ({label})</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Settings>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>10</Count>
    </RestartOnFailure>
    <Hidden>true</Hidden>
  </Settings>
  <Actions>
    <Exec>
      <Command>{sidecar_path}</Command>
    </Exec>
  </Actions>
</Task>
"#
    )
}

#[cfg(target_os = "windows")]
async fn install_windows(label: &str, sidecar_path: &str) -> Result<(), String> {
    use std::io::Write;
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("{label}.xml"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(render_task_xml(label, sidecar_path).as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let out = command_output(
        "schtasks",
        vec![
            "/Create".into(),
            "/TN".into(),
            label.into(),
            "/XML".into(),
            tmp.to_string_lossy().into_owned(),
            "/F".into(),
        ],
    )
    .await?;
    let _ = std::fs::remove_file(&tmp);
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn uninstall_windows(label: &str) -> Result<(), String> {
    let out = command_output(
        "schtasks",
        vec!["/Delete".into(), "/TN".into(), label.into(), "/F".into()],
    )
    .await?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn status_windows(label: &str) -> Result<DaemonStatus, String> {
    let out = command_output(
        "schtasks",
        vec![
            "/Query".into(),
            "/TN".into(),
            label.into(),
            "/FO".into(),
            "LIST".into(),
        ],
    )
    .await?;
    let installed = out.status.success();
    let running = installed
        && String::from_utf8_lossy(&out.stdout).contains("Status:")
        && String::from_utf8_lossy(&out.stdout).contains("Running");
    Ok(DaemonStatus {
        installed,
        running,
        label: label.to_string(),
        message: if installed {
            "installed".into()
        } else {
            "not installed".into()
        },
    })
}

#[cfg(target_os = "windows")]
async fn kickstart_windows(label: &str) -> Result<(), String> {
    let out = command_output("schtasks", vec!["/Run".into(), "/TN".into(), label.into()]).await?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn daemon_install(
    label: Option<String>,
    sidecar_path: String,
) -> Result<DaemonStatus, String> {
    let label = label.unwrap_or_else(|| DEFAULT_LABEL.into());
    validate_label(&label)?;
    validate_sidecar_path(&sidecar_path)?;

    #[cfg(target_os = "macos")]
    install_macos(&label, &sidecar_path).await?;
    #[cfg(target_os = "linux")]
    install_linux(&label, &sidecar_path).await?;
    #[cfg(target_os = "windows")]
    install_windows(&label, &sidecar_path).await?;

    daemon_status(Some(label)).await
}

#[tauri::command]
pub async fn daemon_uninstall(label: Option<String>) -> Result<DaemonStatus, String> {
    let label = label.unwrap_or_else(|| DEFAULT_LABEL.into());
    validate_label(&label)?;

    #[cfg(target_os = "macos")]
    uninstall_macos(&label).await?;
    #[cfg(target_os = "linux")]
    uninstall_linux(&label).await?;
    #[cfg(target_os = "windows")]
    uninstall_windows(&label).await?;

    daemon_status(Some(label)).await
}

#[tauri::command]
pub async fn daemon_status(label: Option<String>) -> Result<DaemonStatus, String> {
    let label = label.unwrap_or_else(|| DEFAULT_LABEL.into());
    validate_label(&label)?;

    #[cfg(target_os = "macos")]
    return status_macos(&label).await;
    #[cfg(target_os = "linux")]
    return status_linux(&label).await;
    #[cfg(target_os = "windows")]
    return status_windows(&label).await;

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Unsupported platform".into())
}

#[tauri::command]
pub async fn daemon_kickstart(label: Option<String>) -> Result<DaemonStatus, String> {
    let label = label.unwrap_or_else(|| DEFAULT_LABEL.into());
    validate_label(&label)?;

    #[cfg(target_os = "macos")]
    kickstart_macos(&label).await?;
    #[cfg(target_os = "linux")]
    kickstart_linux(&label).await?;
    #[cfg(target_os = "windows")]
    kickstart_windows(&label).await?;

    daemon_status(Some(label)).await
}

#[tauri::command]
pub async fn daemon_logs_tail(lines: Option<u32>) -> Result<String, String> {
    let n = lines.unwrap_or(100).clamp(1, 5000) as usize;
    let path = home_dir()?.join(".neumar").join("logs").join("sidecar.log");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let collected: Vec<&str> = content.lines().collect();
    let start = collected.len().saturating_sub(n);
    Ok(collected[start..].join("\n"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_validation() {
        assert!(validate_label("ai.neuma.daemon").is_ok());
        assert!(validate_label("Neuma_test-1").is_ok());
        assert!(validate_label("").is_err());
        assert!(validate_label("bad space").is_err());
        assert!(validate_label("rm -rf /").is_err());
        assert!(validate_label(&"x".repeat(200)).is_err());
    }

    #[test]
    fn sidecar_path_validation() {
        assert!(validate_sidecar_path("/abs/path/neuma-api").is_ok());
        assert!(validate_sidecar_path("").is_err());
        assert!(validate_sidecar_path("relative/neuma-api").is_err());
        assert!(validate_sidecar_path("/abs/path\nInjected=true").is_err());
        assert!(validate_sidecar_path(" /abs/path/neuma-api").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn plist_contains_required_keys() {
        let p = render_plist("ai.neuma.daemon", "/abs/path/neuma-api");
        assert!(p.contains("<key>Label</key>"));
        assert!(p.contains("ai.neuma.daemon"));
        assert!(p.contains("/abs/path/neuma-api"));
        assert!(p.contains("<key>KeepAlive</key>"));
        assert!(p.contains("<key>RunAtLoad</key>"));
        assert!(p.contains("NEUMA_LAUNCHD_LABEL"));
        assert!(p.contains("NEUMA_DAEMON"));
        assert!(p.contains("<integer>10</integer>"));
        let escaped = render_plist("ai.neuma.daemon", "/abs/path/<neuma>&api");
        assert!(escaped.contains("/abs/path/&lt;neuma&gt;&amp;api"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unit_contains_required_keys() {
        let u = render_unit("ai.neuma.daemon", "/abs/path/neuma-api");
        assert!(u.contains("ExecStart=\"/abs/path/neuma-api\""));
        assert!(u.contains("Restart=on-failure"));
        assert!(u.contains("RestartSec=5"));
        assert!(u.contains("StartLimitBurst=10"));
        assert!(u.contains("Environment=NEUMA_DAEMON=1"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn task_xml_contains_required_keys() {
        let x = render_task_xml("ai.neuma.daemon", "C:\\Path\\neuma-api.exe");
        assert!(x.contains("<LogonTrigger>"));
        assert!(x.contains("<RestartOnFailure>"));
        assert!(x.contains("C:\\Path\\neuma-api.exe"));
        let escaped = render_task_xml("ai.neuma.daemon", "C:\\Path\\<neuma>&api.exe");
        assert!(escaped.contains("C:\\Path\\&lt;neuma&gt;&amp;api.exe"));
    }
}
