/**
 * Migration 001: Complete Schema (consolidated)
 *
 * Single migration containing the entire database schema.
 * All previous migrations (001–008) have been folded into this file.
 *
 * Next migration version: 2
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 1,
  description: 'Complete schema — all tables and indexes',
  up(db: Database.Database) {
    // ──────────────────────────────────────────────────────────────────
    // Sessions
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        prompt TEXT NOT NULL,
        task_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Tasks
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT,
        task_index INTEGER,
        prompt TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        cost REAL,
        duration INTEGER,
        favorite INTEGER DEFAULT 0,
        work_dir TEXT,
        additional_work_dirs TEXT,
        agent_session_id TEXT,
        started_at TEXT,
        heartbeat_at TEXT,
        project_id TEXT,
        goal_id TEXT,
        parent_task_id TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        labels TEXT,
        blocked_reason TEXT,
        assignee_profile_id TEXT,
        queue_status TEXT DEFAULT 'unassigned',
        queue_priority INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(queue_status, queue_priority, created_at);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Messages
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
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
        cost REAL,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_creation INTEGER,
        model TEXT,
        branch_id TEXT DEFAULT 'main',
        parent_message_id INTEGER DEFAULT NULL,
        agui_type TEXT,
        run_id TEXT,
        step_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id) WHERE message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_branch ON messages(task_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(task_id, parent_message_id) WHERE parent_message_id IS NOT NULL;
    `);

    // ──────────────────────────────────────────────────────────────────
    // Files
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        preview TEXT,
        thumbnail TEXT,
        is_favorite INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_files_task_id ON files(task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_files_task_path ON files(task_id, path);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Media versions
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
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
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_media_versions_task_id ON media_versions(task_id);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Settings
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // ──────────────────────────────────────────────────────────────────
    // Memories (with v2 cognitive types, scoping, decay + v3 visibility)
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id                    TEXT PRIMARY KEY NOT NULL,
        content               TEXT NOT NULL,
        category              TEXT NOT NULL DEFAULT 'other',
        importance            REAL NOT NULL DEFAULT 0.7,
        source                TEXT NOT NULL DEFAULT 'manual',
        session_id            TEXT,
        access_count          INTEGER NOT NULL DEFAULT 0,
        last_accessed_at      TEXT,
        has_embedding         INTEGER NOT NULL DEFAULT 0,
        memory_type           TEXT NOT NULL DEFAULT 'semantic',
        scope_type            TEXT NOT NULL DEFAULT 'global',
        scope_id              TEXT DEFAULT NULL,
        decay_rate            REAL NOT NULL DEFAULT 0.023,
        last_accessed_strength REAL NOT NULL DEFAULT 1.0,
        confidence            REAL NOT NULL DEFAULT 0.7,
        valid_from            TEXT DEFAULT NULL,
        valid_until           TEXT DEFAULT NULL,
        parent_id             TEXT DEFAULT NULL,
        consolidated_from     TEXT DEFAULT NULL,
        lifecycle_status      TEXT NOT NULL DEFAULT 'active',
        metadata              TEXT DEFAULT NULL,
        language              TEXT DEFAULT NULL,
        visibility            TEXT NOT NULL DEFAULT 'private',
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_category      ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_importance     ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at     ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_has_embedding  ON memories(has_embedding);
      CREATE INDEX IF NOT EXISTS idx_memories_scope          ON memories(scope_type, scope_id);
      CREATE INDEX IF NOT EXISTS idx_memories_scope_type     ON memories(scope_type, memory_type);
      CREATE INDEX IF NOT EXISTS idx_memories_lifecycle      ON memories(lifecycle_status);
      CREATE INDEX IF NOT EXISTS idx_memories_language       ON memories(language);
    `);

    // FTS5 with unicode61 tokenizer (CJK support)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61'
      )
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content)
          VALUES('delete', old.rowid, old.content);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content)
          VALUES('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    // ──────────────────────────────────────────────────────────────────
    // Memory entity graph
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        summary TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        mention_count INTEGER NOT NULL DEFAULT 1,
        metadata TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_entities_name
        ON memory_entities(name);
      CREATE INDEX IF NOT EXISTS idx_memory_entities_type
        ON memory_entities(entity_type);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entity_edges (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        valid_from TEXT DEFAULT NULL,
        valid_until TEXT DEFAULT NULL,
        source_memory_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_entity_id)
          REFERENCES memory_entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id)
          REFERENCES memory_entities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memory_edges_source
        ON memory_entity_edges(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_target
        ON memory_entity_edges(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_valid
        ON memory_entity_edges(valid_until);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Memory consolidation log
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_consolidation_log (
        id TEXT PRIMARY KEY,
        run_at TEXT NOT NULL DEFAULT (datetime('now')),
        memories_reviewed INTEGER NOT NULL DEFAULT 0,
        memories_merged INTEGER NOT NULL DEFAULT 0,
        memories_archived INTEGER NOT NULL DEFAULT 0,
        memories_pruned INTEGER NOT NULL DEFAULT 0,
        entities_created INTEGER NOT NULL DEFAULT 0,
        edges_created INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0
      )
    `);

    // ──────────────────────────────────────────────────────────────────
    // Session journals (append-only observation logs)
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_journals (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_journals_session
        ON session_journals(session_id, created_at);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Embedding cache
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT NOT NULL,
        model        TEXT NOT NULL,
        embedding    BLOB NOT NULL,
        dim          INTEGER NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (content_hash, model)
      )
    `);

    // ──────────────────────────────────────────────────────────────────
    // Session memory chunks
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_memory_chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content     TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        has_embedding INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, chunk_index)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_chunks_task ON session_memory_chunks(task_id);
      CREATE INDEX IF NOT EXISTS idx_session_chunks_embedding ON session_memory_chunks(has_embedding);
    `);

    // ──────────────────────────────────────────────────────────────────
    // OAuth connections
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
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
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider);
      CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Usage logs
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id                    TEXT PRIMARY KEY NOT NULL,
        task_id               TEXT,
        session_id            TEXT,
        parent_id             TEXT,
        call_type             TEXT NOT NULL,
        provider              TEXT,
        model                 TEXT,
        billing_type          TEXT NOT NULL DEFAULT 'api',
        billing_scope         TEXT,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        input_cost            INTEGER NOT NULL DEFAULT 0,
        output_cost           INTEGER NOT NULL DEFAULT 0,
        cache_read_cost       INTEGER NOT NULL DEFAULT 0,
        cache_creation_cost   INTEGER NOT NULL DEFAULT 0,
        total_cost            INTEGER NOT NULL DEFAULT 0,
        unit_cost             INTEGER NOT NULL DEFAULT 0,
        unit_type             TEXT,
        unit_count            INTEGER NOT NULL DEFAULT 0,
        latency_ms            INTEGER NOT NULL DEFAULT 0,
        status                TEXT NOT NULL DEFAULT 'success',
        error_message         TEXT,
        metadata              TEXT DEFAULT '{}',
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at        ON usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_billing_created   ON usage_logs(billing_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_created  ON usage_logs(provider, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_model_created     ON usage_logs(model, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_call_type_created ON usage_logs(call_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_task_id           ON usage_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_parent_id         ON usage_logs(parent_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id        ON usage_logs(session_id);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Model pricing
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_pricing (
        model_id                        TEXT PRIMARY KEY NOT NULL,
        provider                        TEXT NOT NULL DEFAULT '',
        display_name                    TEXT NOT NULL DEFAULT '',
        input_cost_per_million          INTEGER NOT NULL DEFAULT 0,
        output_cost_per_million         INTEGER NOT NULL DEFAULT 0,
        cache_read_cost_per_million     INTEGER NOT NULL DEFAULT 0,
        cache_creation_cost_per_million INTEGER NOT NULL DEFAULT 0,
        unit_cost                       INTEGER NOT NULL DEFAULT 0,
        unit_type                       TEXT,
        is_default                      INTEGER NOT NULL DEFAULT 0,
        default_billing_type            TEXT NOT NULL DEFAULT 'api',
        updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // ──────────────────────────────────────────────────────────────────
    // Orchestration runs
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        resume_token TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orch_runs_task ON orchestration_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_orch_runs_status ON orchestration_runs(status);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Projects and goals
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        workspace TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        project_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Task links and comments
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_links (
        id TEXT PRIMARY KEY,
        from_task_id TEXT NOT NULL,
        to_task_id TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'parent_child',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_links_from ON task_links(from_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_links_to ON task_links(to_task_id);

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author_type TEXT NOT NULL DEFAULT 'user',
        author_id TEXT,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Activity events
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        project_id TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_activity_events_entity  ON activity_events(entity_type, entity_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_events_project ON activity_events(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_events_type    ON activity_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_activity_events_actor   ON activity_events(actor_id, created_at DESC);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Agent profiles (with soul system)
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        description TEXT,
        avatar_color TEXT,
        avatar_icon TEXT,
        runtime_id TEXT NOT NULL,
        default_model TEXT,
        default_provider TEXT,
        default_mcp_servers TEXT,
        default_skills TEXT,
        system_prompt TEXT,
        soul TEXT DEFAULT NULL,
        soul_version INTEGER DEFAULT 0,
        soul_origin TEXT DEFAULT 'user',
        corrections_log TEXT DEFAULT NULL,
        learnings TEXT DEFAULT NULL,
        max_concurrent_tasks INTEGER DEFAULT 1,
        max_delegation_depth INTEGER DEFAULT 3,
        allowed_delegates TEXT,
        session_compaction_policy TEXT DEFAULT 'auto',
        max_session_messages INTEGER DEFAULT 100,
        default_thinking_config TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON agent_profiles(status);
    `);

    // ──────────────────────────────────────────────────────────────────
    // User templates
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'dev',
        system_prompt TEXT NOT NULL,
        suggested_model TEXT,
        skills TEXT,
        mcp_servers TEXT,
        starter_prompts TEXT NOT NULL,
        icon TEXT,
        is_built_in INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_templates_category ON user_templates(category);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Budget policies and spend cache
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_policies (
        id TEXT PRIMARY KEY,
        name TEXT,
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        period_type TEXT NOT NULL DEFAULT 'monthly',
        limit_usd REAL NOT NULL,
        alert_threshold_pct INTEGER NOT NULL DEFAULT 75,
        hard_stop INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS budget_spend_cache (
        policy_id TEXT NOT NULL REFERENCES budget_policies(id) ON DELETE CASCADE,
        period_start TEXT NOT NULL,
        spend_usd REAL NOT NULL DEFAULT 0,
        last_updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (policy_id, period_start)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_policies_scope   ON budget_policies(scope_type, scope_id);
      CREATE INDEX IF NOT EXISTS idx_budget_policies_enabled ON budget_policies(enabled);
    `);

    // ──────────────────────────────────────────────────────────────────
    // File snapshots
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_snapshots (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        content_before TEXT,
        content_after TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_file_snapshots_task      ON file_snapshots(task_id);
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_task_path ON file_snapshots(task_id, file_path);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Task documents with version history
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_documents (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        doc_key TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_documents_current ON task_documents(task_id, doc_key);
      CREATE INDEX IF NOT EXISTS idx_task_documents_task ON task_documents(task_id);

      CREATE TABLE IF NOT EXISTS task_document_history (
        history_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES task_documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_by TEXT DEFAULT 'user',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_doc_history_doc ON task_document_history(document_id);

      CREATE TRIGGER IF NOT EXISTS trg_task_document_history
      BEFORE UPDATE ON task_documents
      BEGIN
        INSERT INTO task_document_history
          (history_id, document_id, content, version, created_by, created_at)
        VALUES
          (hex(randomblob(16)), OLD.id, OLD.content, OLD.version, OLD.created_by, OLD.updated_at);
      END;
    `);

    // ──────────────────────────────────────────────────────────────────
    // Approvals
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by_type TEXT NOT NULL,
        requested_by_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        payload TEXT,
        decided_by TEXT,
        decision_reason TEXT,
        decided_at TEXT,
        expires_at TEXT,
        orchestration_run_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_status      ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_entity      ON approvals(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_type_status ON approvals(approval_type, status);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Channel system
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_config (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        token TEXT,
        mode TEXT DEFAULT 'polling',
        rate_limit INTEGER DEFAULT 10,
        enabled INTEGER NOT NULL DEFAULT 1,
        guardrails_provider TEXT NOT NULL DEFAULT 'none',
        guardrails_fail_mode TEXT NOT NULL DEFAULT 'open',
        model TEXT,
        mention_only INTEGER NOT NULL DEFAULT 0,
        agent_profile_id TEXT DEFAULT NULL,
        block_kit_progress INTEGER DEFAULT 1,
        access_mode TEXT DEFAULT 'open',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS channel_users (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        display_name TEXT,
        approved_at TEXT,
        permission_tier TEXT NOT NULL DEFAULT 'operator',
        token_budget INTEGER NOT NULL DEFAULT 0,
        tokens_used_today INTEGER NOT NULL DEFAULT 0,
        tokens_period_start TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_users_platform ON channel_users(platform, platform_user_id);

      CREATE TABLE IF NOT EXISTS channel_pairing_codes (
        code TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channel_sessions (
        id               TEXT PRIMARY KEY,
        platform         TEXT NOT NULL,
        session_key      TEXT NOT NULL,
        channel_user_id  TEXT REFERENCES channel_users(id) ON DELETE SET NULL,
        agent_session_id TEXT,
        agent_task_id    TEXT,
        status           TEXT NOT NULL DEFAULT 'active',
        context_summary  TEXT,
        last_activity_at TEXT,
        error_count      INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_sessions_key  ON channel_sessions(platform, session_key);
      CREATE INDEX IF NOT EXISTS idx_channel_sessions_user        ON channel_sessions(channel_user_id);

      CREATE TABLE IF NOT EXISTS channel_messages (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL REFERENCES channel_sessions(id) ON DELETE CASCADE,
        platform            TEXT NOT NULL,
        platform_message_id TEXT,
        direction           TEXT NOT NULL,
        content             TEXT NOT NULL,
        content_type        TEXT NOT NULL DEFAULT 'text',
        token_count         INTEGER NOT NULL DEFAULT 0,
        metadata            TEXT NOT NULL DEFAULT '{}',
        created_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_dedup
        ON channel_messages(platform, platform_message_id)
        WHERE platform_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_channel_messages_session ON channel_messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS channel_audit_log (
        id              TEXT PRIMARY KEY,
        channel_user_id TEXT,
        platform        TEXT,
        action          TEXT NOT NULL,
        details         TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_channel_audit_time ON channel_audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_channel_audit_user ON channel_audit_log(channel_user_id, created_at DESC);
    `);

    // ──────────────────────────────────────────────────────────────────
    // WebUI sessions
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS webui_sessions (
        token TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webui_sessions_family  ON webui_sessions(family);
      CREATE INDEX IF NOT EXISTS idx_webui_sessions_expires ON webui_sessions(expires_at);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Operating profiles
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS operating_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        agent_profile_ids TEXT,
        budget_policy_ids TEXT,
        mcp_defaults TEXT,
        skills_defaults TEXT,
        workspace_root TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_operating_profiles_active ON operating_profiles(is_active);
    `);

    // ──────────────────────────────────────────────────────────────────
    // Secure secrets
    // ──────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS secure_secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        hint TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  },
};
