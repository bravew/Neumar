---
summary: "Tauri 2 desktop shell — configuration, Rust core, SQLite migrations, sidecar management, capabilities, and permissions"
read_when:
  - Working with the Tauri desktop layer
  - Modifying database migrations
  - Understanding sidecar lifecycle
  - Adjusting file system permissions or capabilities
title: "Desktop Shell"
---

# Desktop Shell (`src-tauri/`)

## Tauri Configuration

**`tauri.conf.json`** defines the desktop application:

| Setting | Value |
|---------|-------|
| App name | `<displayName>` from `branding.json` |
| Identifier | `<identifier>` from `branding.json` |
| Window size | 1200 × 800 px |
| External binary | `<binaryName>` sidecar (from `branding.json`) |
| Bundle resources | Native speech/embedding addons (`dist/sherpa-onnx/**/*`, `dist/onnxruntime/**/*`), CLI bundle (`dist/cli-bundle/**/*`) |
| Dev URL | `http://localhost:3420` |
| Build output | `../dist` |

## Rust Core

The Rust layer (`src-tauri/src/lib.rs`) handles:

1. **Database migrations** — versioned schema migrations (initial + incremental)
2. **Sidecar lifecycle** — spawns/kills the API binary based on environment
3. **Plugin registration** — initializes Tauri plugins (SQL, FS, Shell, Opener, Dialog, Notification)
4. **Port management** — kills existing processes on the API port at startup

## SQLite Migrations

Migrations run at app startup via the Tauri SQL plugin:

| # | Migration | Description |
|---|-----------|-------------|
| 1 | `initial_schema` | `sessions`, `tasks` (including `work_dir`), `messages` (with `message_id` unique index), `files`, `media_versions`, `settings`, plus all indexes |
| 2 | `add_message_cost_usage_model` | Adds `cost` (REAL), `usage_input` (INTEGER), `usage_output` (INTEGER), `model` (TEXT) columns to `messages` |
| 3 | `add_message_cache_usage` | Adds `usage_cache_read` (INTEGER), `usage_cache_creation` (INTEGER) columns to `messages` |

All tables use `IF NOT EXISTS` for idempotent execution. The backend database module
(`src-api/src/shared/db/index.ts`) uses a consolidated two-migration system (001 init + 002 catchup)
that produces the same schema. The Tauri SQLite plugin and backend `better-sqlite3`
instance produce identical schemas.

## Sidecar Management

```
┌──────────────┐       spawn        ┌──────────────┐
│  Tauri App   │ ──────────────────▶│  API Binary   │
│  (Rust)      │                    │ (Node binary)│
│              │◀── port 2620 ─────│              │
│              │      HTTP          │              │
└──────┬───────┘                    └──────────────┘
       │ cleanup on exit
       ▼
  kill child process
```

**Production behavior:**
1. Kill any existing process on port 2620
2. Spawn the API sidecar binary with `PORT=2620, NODE_ENV=production, RESOURCES_DIR=<resource_dir>`
3. Track child PID for cleanup
4. On app exit → kill sidecar process

**Development behavior:**
- Sidecar spawning is disabled
- Expects developer to run `pnpm dev:api` separately on port 5126

## Background Daemon Supervisor

`src-tauri/src/daemon.rs` exposes Tauri commands used by **Settings → Advanced → Run in background**. The commands install, uninstall, inspect, restart, and tail logs for an OS-native supervisor that keeps the API sidecar available while the desktop window is closed.

| Command | Purpose |
|---------|---------|
| `daemon_install(label?, sidecar_path)` | Validate the label/path, write the OS supervisor template, enable/start the service, then return status |
| `daemon_uninstall(label?)` | Stop/remove the service or task, then return status |
| `daemon_status(label?)` | Report installed/running state and a platform-specific message |
| `daemon_kickstart(label?)` | Restart/kickstart the supervisor target |
| `daemon_logs_tail(lines?)` | Return the last 1–5000 lines from `~/.neumar/logs/sidecar.log` |

**Platform templates:**

| Platform | Supervisor | Location / Mechanism |
|----------|------------|----------------------|
| macOS | `launchd` LaunchAgent | `~/Library/LaunchAgents/<label>.plist`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval=10` |
| Linux | systemd user unit | `~/.config/systemd/user/<label>.service`, `Restart=on-failure`, `RestartSec=5`, `StartLimitBurst=10` |
| Windows | Task Scheduler | XML registered via `schtasks /Create`, logon trigger, `RestartOnFailure`, hidden task |

Labels must match `[A-Za-z0-9._-]+`. `sidecar_path` must be absolute, trimmed, and free of control characters. XML-backed templates escape inserted values, and systemd quotes `ExecStart` so user-supplied path contents cannot inject extra supervisor directives. Shell-outs use `Command::new().args([...])` with spawn-blocking wrappers so daemon operations do not block the Tauri async runtime.

## Native Geolocation (macOS)

The Rust layer exposes a `get_location` Tauri command that retrieves the user's approximate
location via macOS CoreLocation framework (`objc2-core-location`).

**Behavior:**
1. Checks `CLLocationManager.authorizationStatus()`:
   - **Not Determined** → calls `requestWhenInUseAuthorization()`, returns `None` (next call
     will have the user's answer)
   - **Restricted / Denied** → returns `None`
   - **Authorized** → reads `manager.location()` (last known location)
2. Returns `{ latitude, longitude, accuracy }` or `null`

**Required configuration:**
- `Info.plist` — `NSLocationWhenInUseUsageDescription` privacy string
- `entitlements.plist` — `com.apple.security.personal-information.location` entitlement

**Non-macOS platforms** return `None`. The frontend `useRuntimeContext` hook falls back to
the browser Geolocation API when not running in Tauri.

## System Tray

The app integrates a system tray icon for background presence using Tauri's `TrayIconBuilder` API.

**Behavior:**
- Closing the main window hides it instead of exiting (`window.hide()` with `prevent_close()`)
- System tray icon appears with tooltip showing the app name
- Left-click opens a context menu with:
  - **Show [AppName]** — reveals and brings window to foreground
  - **Quit [AppName]** — exits the application and cleans up the sidecar

**macOS-specific:**
- Uses `objc2` bindings for `NSApplication.activateIgnoringOtherApps()` to ensure proper window foregrounding
- Icon rendered as template icon (`icon_as_template(true)`) for native menu bar styling
- Retina support via `tray-icon@2x.png` bundled with `include_bytes!`

**Reopen event (dock click):**
- On macOS, clicking the dock icon when no windows are visible automatically shows the main window

**Icon assets:**
- `src-tauri/icons/tray-icon.png` — standard resolution
- `src-tauri/icons/tray-icon@2x.png` — retina resolution

## Capabilities & Permissions

The Tauri capability system restricts what the app can access:

| Category | Permissions |
|----------|-------------|
| **Core** | Default Tauri capabilities |
| **SQL** | Execute, select, load, close (SQLite) |
| **File System** | Read/write within scoped paths |
| **Shell** | Spawn processes, kill processes, execute sidecars |
| **Dialog** | Native folder/file picker dialogs (used for per-task workspace selection) |
| **Notification** | Native OS notifications (task completion alerts when app is not focused) |
| **Opener** | Open URLs and files in default apps |

**File system scopes** (sandboxed access):
- `$HOME/.<slug>/**` — application data
- `$HOME/.claude/**` — Claude Code configuration
- `$DOWNLOAD/**`, `$DESKTOP/**`, `$DOCUMENT/**` — user directories

**macOS entitlements:**
- JIT compilation (Node.js/V8)
- Unsigned executable memory (required by onnxruntime-node)
- Location services (geolocation context for AI prompts)

---

*See also: [System Overview](../system/overview.md) · [Database Schema](../reference/database-schema.md) · [Build & Deployment](../build/index.md)*
