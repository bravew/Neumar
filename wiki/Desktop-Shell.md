# Desktop Shell

The Tauri 2 desktop shell provides the native OS integration layer: window management, SQLite access, file system permissions, sidecar lifecycle, and platform-specific features like macOS geolocation.

---

## Technology Stack

| Component | Technology |
|---|---|
| Framework | Tauri 2 |
| Language | Rust |
| Database bridge | `tauri-plugin-sql` (SQLite) |
| File system | `tauri-plugin-fs` |
| Process management | `tauri-plugin-shell` |
| Dialogs | `tauri-plugin-dialog` |
| Notifications | `tauri-plugin-notification` |
| URL opener | `tauri-plugin-opener` |
| Geolocation | Custom Rust command (CoreLocation on macOS) |

---

## Project Structure

```
src-tauri/
├── src/
│   ├── main.rs           Entry point
│   ├── lib.rs            Tauri app setup, plugin registration
│   ├── commands/
│   │   └── geolocation.rs  Native CoreLocation integration
│   └── sidecar.rs        API sidecar spawn/kill logic
├── migrations/
│   ├── 001_initial.sql
│   ├── 002_message_costs.sql
│   └── 003_cache_tokens.sql
├── capabilities/
│   └── default.json      Tauri capability declarations
├── icons/                Platform icon files
├── Cargo.toml
└── tauri.conf.json       Tauri configuration
```

---

## Sidecar Management

The API server runs as a **sidecar binary** — a child process spawned and managed by Tauri.

### Startup

1. Tauri app launches
2. `sidecar.rs` spawns `neuma-api-<target-triple>` binary
3. Sidecar starts on port 2620
4. WebView loads `localhost:2620` (production) or `localhost:3420` (dev)

### Shutdown

On app quit:
1. Tauri sends SIGTERM to the sidecar
2. Sidecar persists pipeline state
3. Sidecar flushes memory write queue
4. Sidecar closes SQLite connections
5. Process exits

The sidecar binary is bundled in `src-tauri/binaries/`:
```
neuma-api-aarch64-apple-darwin    (macOS ARM)
neuma-api-x86_64-apple-darwin     (macOS Intel)
neuma-api-x86_64-unknown-linux-gnu (Linux)
neuma-api-x86_64-pc-windows-msvc  (Windows)
```

---

## SQLite Migrations

Migrations run automatically at app startup via `tauri-plugin-sql`:

```sql
-- 001_initial.sql
CREATE TABLE sessions (...);
CREATE TABLE tasks (...);
CREATE TABLE messages (...);
CREATE TABLE files (...);
CREATE TABLE media_versions (...);
CREATE TABLE settings (...);

-- 002_message_costs.sql
ALTER TABLE messages ADD COLUMN cost REAL;
ALTER TABLE messages ADD COLUMN usage_input INTEGER;
ALTER TABLE messages ADD COLUMN usage_output INTEGER;
ALTER TABLE messages ADD COLUMN model TEXT;

-- 003_cache_tokens.sql
ALTER TABLE messages ADD COLUMN usage_cache_read INTEGER;
ALTER TABLE messages ADD COLUMN usage_cache_creation INTEGER;
```

Migrations are applied in order and each is run at most once (tracked internally by `tauri-plugin-sql`).

See [[Database Schema]] for the complete schema.

---

## Capabilities

Tauri capabilities (`capabilities/default.json`) declare what the WebView is allowed to do:

```json
{
  "identifier": "default",
  "description": "Default capability set",
  "platforms": ["macOS", "linux", "windows"],
  "permissions": [
    "core:path:default",
    "core:event:default",
    "core:window:default",
    "core:app:default",
    "core:resources:default",
    "core:menu:default",
    "core:tray:default",
    "sql:default",
    "shell:allow-execute",
    "shell:allow-open",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-create-dir",
    "dialog:allow-open",
    "dialog:allow-save",
    "notification:default",
    "opener:allow-open-url"
  ]
}
```

File system access is scoped to:
- `$APPDATA` — `~/.<slug>/`
- `$DOCUMENT` — User documents folder (for workspace selection)

---

## macOS Entitlements

`src-tauri/entitlements.plist` includes:

| Entitlement | Reason |
|---|---|
| `com.apple.security.cs.allow-jit` | Required for JavaScript JIT in WebKit |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Required for some native Node.js addons |
| `com.apple.security.personal-information.location` | Native geolocation via CoreLocation |

---

## Native Geolocation

A custom Tauri command provides geolocation on macOS using **CoreLocation** directly (no browser permission prompt):

```rust
#[tauri::command]
async fn get_location() -> Result<Location, String> {
    // Uses CoreLocation framework
    // Returns lat/lon rounded to 2 decimal places
}
```

The frontend calls this via Tauri's invoke API. Location is injected into agent context for tasks that benefit from location awareness (e.g., "find restaurants near me").

Privacy protection: coordinates are rounded to 2 decimal places (~1 km precision) before injection into prompts.

---

## Window Configuration

`tauri.conf.json` window defaults:

```json
{
  "windows": [{
    "title": "Neuma",
    "width": 1280,
    "height": 800,
    "minWidth": 800,
    "minHeight": 600,
    "resizable": true,
    "fullscreen": false
  }]
}
```

---

## App Data Directory

At runtime, Tauri resolves the app data path:
- **macOS:** `~/Library/Application Support/<identifier>/` or `~/.<slug>/`
- **Linux:** `~/.config/<slug>/`
- **Windows:** `%APPDATA%\<slug>\`

The API uses `~/.<slug>/` directly (via `getSetting('workDir')`) to stay consistent across platforms.

---

## Further Reading

- [[Architecture]] — How the shell integrates with frontend and API
- [[Database Schema]] — SQLite migrations and tables
- [[Build and Deployment]] — Producing platform-specific installers
- [[Security]] — Capability scoping and entitlements
