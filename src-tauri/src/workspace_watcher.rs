//! Workspace file-system watcher that drives the in-app Graphify rebuild and
//! the workspace-RAG incremental reindex.
//!
//! ## Behaviour
//!
//! - Watches the user's `workDir` recursively via the `notify` crate.
//! - Skips a fixed set of "always-ignored" directory names (`.git`,
//!   `node_modules`, build outputs, `.neuma`, `graphify-out`, etc.) so we never
//!   thrash on dependency or output churn.
//! - Coalesces events into two independently-debounced buckets:
//!     * **graphify** — any source-file event arms a 5-second timer; on fire
//!       we POST `/graphify/rebuild` (the Hono runner's own debounce makes the
//!       second hop a no-op while a rebuild is already in flight).
//!     * **rag** — collected changed paths are flushed every 30 s via
//!       `POST /rag/reindex` with a `paths` array, so we incrementally
//!       re-embed only what changed.
//!
//! ## Frontend contract
//!
//! Two Tauri commands:
//!   - `start_workspace_watcher({ work_dir, api_base_url })`
//!   - `stop_workspace_watcher()`
//!
//! The frontend invokes `start` after settings load; calling it again with a
//! different `work_dir` first stops the previous watcher and then starts a
//! fresh one. Idempotent — calling with the same args while running is a
//! no-op.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

const GRAPHIFY_DEBOUNCE: Duration = Duration::from_secs(5);
const RAG_DEBOUNCE: Duration = Duration::from_secs(30);

/// Substrings (with surrounding `/`) we never propagate from the watcher.
/// Mirrors `ALWAYS_IGNORE` in `src-api/src/shared/services/rag/indexer.ts`.
/// Keep both sides in sync if you add an entry here.
const ALWAYS_IGNORE: &[&str] = &[
    "/.git/",
    "/node_modules/",
    "/.next/",
    "/dist/",
    "/build/",
    "/target/",
    "/.turbo/",
    "/.cache/",
    "/.venv/",
    "/venv/",
    "/__pycache__/",
    "/.pytest_cache/",
    "/.mypy_cache/",
    "/.idea/",
    "/.vscode/",
    "/.neuma/",
    "/.neumar/",
    "/graphify-out/",
    "/coverage/",
    "/.next-prod/",
    "/out/",
];

/// File extensions that should *trigger* graphify or RAG reactions. Anything
/// else (binary blobs, `.lock` files, OS turds) is silently ignored. Keep
/// this generous on the source-code side — false positives only mean an
/// extra debounced API call.
const TRIGGER_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cc", "cpp",
    "hpp", "cs", "rb", "php", "swift", "scala", "sh", "bash", "zsh", "json", "md", "mdx", "toml",
    "yaml", "yml", "sql", "html", "css", "scss",
];

#[derive(Debug, Default)]
struct PendingState {
    /// Set when any source file changed; cleared after we POST to /graphify.
    graphify_dirty: bool,
    graphify_deadline: Option<Instant>,
    /// Workspace-relative paths to send to /rag/reindex.
    rag_paths: HashSet<String>,
    rag_deadline: Option<Instant>,
}

struct WatcherState {
    work_dir: PathBuf,
    api_base_url: String,
    pending: Mutex<PendingState>,
    /// `true` once the watcher should stop. The notify watcher drops with it.
    shutdown: Mutex<bool>,
    /// Held alive so the OS keeps watching; never read.
    _watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Default)]
pub struct WorkspaceWatcher(Mutex<Option<Arc<WatcherState>>>);

#[derive(Debug, Deserialize)]
pub struct StartArgs {
    pub work_dir: String,
    /// e.g. "http://127.0.0.1:5126" (dev) or "http://127.0.0.1:2620" (prod).
    pub api_base_url: String,
}

#[derive(Debug, Serialize)]
pub struct WatcherStatus {
    pub running: bool,
    pub work_dir: Option<String>,
}

fn path_should_trigger(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    // Use forward-slash normalised form for substring matching even on Windows.
    let normalised = path_str.replace('\\', "/");
    let with_sentinels = format!("/{}/", normalised.trim_matches('/'));
    if ALWAYS_IGNORE
        .iter()
        .any(|needle| with_sentinels.contains(needle))
    {
        return false;
    }
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) => TRIGGER_EXTENSIONS
            .iter()
            .any(|allow| allow.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

/// Convert an absolute event path into a workspace-relative POSIX path. Skips
/// paths outside the workspace root (notify can occasionally surface those for
/// symlinked targets).
fn relative_to_root(root: &Path, full: &Path) -> Option<String> {
    full.strip_prefix(root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

fn handle_event(state: &Arc<WatcherState>, paths: Vec<PathBuf>) {
    let mut any_trigger = false;
    let mut rels: Vec<String> = Vec::new();
    for path in paths {
        if !path_should_trigger(&path) {
            continue;
        }
        any_trigger = true;
        if let Some(rel) = relative_to_root(&state.work_dir, &path) {
            rels.push(rel);
        }
    }
    if !any_trigger {
        return;
    }
    if let Ok(mut pending) = state.pending.lock() {
        let now = Instant::now();
        pending.graphify_dirty = true;
        pending.graphify_deadline = Some(now + GRAPHIFY_DEBOUNCE);
        for rel in rels {
            pending.rag_paths.insert(rel);
        }
        pending.rag_deadline = Some(now + RAG_DEBOUNCE);
    }
}

fn post_graphify_rebuild(api_base_url: &str) {
    let url = format!("{}/graphify/rebuild", api_base_url.trim_end_matches('/'));
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let _ = agent.post(&url).send_empty();
}

fn post_rag_reindex(api_base_url: &str, paths: Vec<String>) {
    let url = format!("{}/rag/reindex", api_base_url.trim_end_matches('/'));
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(180)))
        .build()
        .into();
    let _ = agent.post(&url).send_json(&serde_json::json!({
        "paths": paths,
        "prune": false
    }));
}

fn flush_loop(state: Arc<WatcherState>) {
    loop {
        // Cooperative shutdown — checked every tick.
        if state.shutdown.lock().map(|g| *g).unwrap_or(true) {
            break;
        }

        let now = Instant::now();
        let (graphify_due, rag_due) = {
            let pending = match state.pending.lock() {
                Ok(g) => g,
                Err(_) => break,
            };
            let g_due = pending.graphify_dirty
                && pending.graphify_deadline.map(|d| d <= now).unwrap_or(false);
            let r_due = !pending.rag_paths.is_empty()
                && pending.rag_deadline.map(|d| d <= now).unwrap_or(false);
            (g_due, r_due)
        };

        if graphify_due {
            // Snapshot + clear before the network call so concurrent events
            // re-arm the debounce instead of being eaten by the in-flight POST.
            let should_send = {
                let mut pending = match state.pending.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if pending.graphify_dirty {
                    pending.graphify_dirty = false;
                    pending.graphify_deadline = None;
                    true
                } else {
                    false
                }
            };
            if should_send {
                post_graphify_rebuild(&state.api_base_url);
            }
        }

        if rag_due {
            let snapshot: Vec<String> = {
                let mut pending = match state.pending.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if pending.rag_paths.is_empty() {
                    Vec::new()
                } else {
                    pending.rag_deadline = None;
                    pending.rag_paths.drain().collect()
                }
            };
            if !snapshot.is_empty() {
                post_rag_reindex(&state.api_base_url, snapshot);
            }
        }

        thread::sleep(Duration::from_millis(500));
    }
}

fn start_internal(state: Arc<WorkspaceWatcher>, args: StartArgs) -> Result<(), String> {
    let work_dir = PathBuf::from(&args.work_dir);
    if !work_dir.is_absolute() {
        return Err(format!("work_dir must be absolute: {}", args.work_dir));
    }
    if !work_dir.exists() {
        return Err(format!("work_dir does not exist: {}", args.work_dir));
    }

    // If already running for the same workspace, no-op.
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.as_ref() {
            if existing.work_dir == work_dir && existing.api_base_url == args.api_base_url {
                return Ok(());
            }
        }
    }

    // Stop the previous watcher (if any) before starting a new one.
    stop_internal(&state)?;

    let watcher_state = Arc::new(WatcherState {
        work_dir: work_dir.clone(),
        api_base_url: args.api_base_url.clone(),
        pending: Mutex::new(PendingState::default()),
        shutdown: Mutex::new(false),
        _watcher: Mutex::new(None),
    });

    // Build the OS watcher and forward events into the shared pending state.
    let event_state = watcher_state.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(ev) => ev,
            Err(_) => return,
        };
        // Only react to create/modify/remove. Metadata-only changes are noise.
        let interesting = matches!(
            event.kind,
            EventKind::Create(_)
                | EventKind::Remove(_)
                | EventKind::Modify(ModifyKind::Data(_))
                | EventKind::Modify(ModifyKind::Name(_))
                | EventKind::Modify(ModifyKind::Any)
        );
        if !interesting {
            return;
        }
        handle_event(&event_state, event.paths);
    })
    .map_err(|e| format!("notify init failed: {}", e))?;

    watcher
        .watch(&work_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("notify watch failed: {}", e))?;

    if let Ok(mut slot) = watcher_state._watcher.lock() {
        *slot = Some(watcher);
    }

    // Background flush loop — std thread (avoids pulling tokio macros in here).
    let flush_state = watcher_state.clone();
    thread::spawn(move || flush_loop(flush_state));

    // Publish the new state so future calls can reuse / replace it.
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(watcher_state);
    }

    Ok(())
}

fn stop_internal(state: &Arc<WorkspaceWatcher>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.take() {
        if let Ok(mut shutdown) = existing.shutdown.lock() {
            *shutdown = true;
        }
        // Drop the OS watcher explicitly so file handles are released.
        if let Ok(mut slot) = existing._watcher.lock() {
            *slot = None;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_workspace_watcher(
    state: tauri::State<'_, Arc<WorkspaceWatcher>>,
    work_dir: String,
    api_base_url: String,
) -> Result<WatcherStatus, String> {
    let inner = state.inner().clone();
    start_internal(
        inner.clone(),
        StartArgs {
            work_dir: work_dir.clone(),
            api_base_url,
        },
    )?;
    Ok(WatcherStatus {
        running: true,
        work_dir: Some(work_dir),
    })
}

#[tauri::command]
pub fn stop_workspace_watcher(
    state: tauri::State<'_, Arc<WorkspaceWatcher>>,
) -> Result<WatcherStatus, String> {
    let inner = state.inner().clone();
    stop_internal(&inner)?;
    Ok(WatcherStatus {
        running: false,
        work_dir: None,
    })
}

#[tauri::command]
pub fn workspace_watcher_status(
    state: tauri::State<'_, Arc<WorkspaceWatcher>>,
) -> Result<WatcherStatus, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(match guard.as_ref() {
        Some(s) => WatcherStatus {
            running: true,
            work_dir: Some(s.work_dir.to_string_lossy().to_string()),
        },
        None => WatcherStatus {
            running: false,
            work_dir: None,
        },
    })
}
