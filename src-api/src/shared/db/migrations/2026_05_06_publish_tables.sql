CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  artifact_id TEXT,
  source_artifact_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_size_bytes INTEGER NOT NULL,
  source_mime TEXT NOT NULL,
  source_provenance_json TEXT,
  source_json TEXT NOT NULL,
  signed_artifact_path TEXT,
  manifest_path TEXT,
  provenance_state TEXT NOT NULL DEFAULT 'unchecked',
  state TEXT NOT NULL DEFAULT 'drafted',
  approval_required INTEGER NOT NULL DEFAULT 0,
  approval_channel TEXT,
  approved_by TEXT,
  approved_at TEXT,
  scheduled_for TEXT,
  idempotency_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_jobs_idempotency_key
  ON publish_jobs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_workspace_state_created
  ON publish_jobs(workspace_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS publish_destination_legs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  destination_kind TEXT NOT NULL,
  destination_label TEXT,
  connection_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  config_json TEXT NOT NULL,
  plan_json TEXT,
  session_id TEXT,
  chunk_offset_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER,
  etags_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_response_json TEXT,
  published_ref_json TEXT,
  error_class TEXT,
  error_message TEXT,
  next_retry_at TEXT,
  locked_by TEXT,
  lease_until TEXT,
  notification_channel_ref TEXT,
  notification_delivered_at TEXT,
  last_progress_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  FOREIGN KEY (job_id)
    REFERENCES publish_jobs(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_destination_legs_job_id
  ON publish_destination_legs(job_id);

CREATE INDEX IF NOT EXISTS idx_publish_destination_legs_state_next_retry_at
  ON publish_destination_legs(state, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_publish_destination_legs_lease_until
  ON publish_destination_legs(lease_until);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_destination_legs_idempotency_key
  ON publish_destination_legs(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_destination_legs_job_kind_connection
  ON publish_destination_legs(job_id, destination_kind, connection_id);

CREATE TABLE IF NOT EXISTS publish_quota_usage (
  connection_id TEXT NOT NULL,
  quota_kind TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (connection_id, quota_kind, window_end)
);

CREATE INDEX IF NOT EXISTS idx_publish_quota_usage_connection_kind_window
  ON publish_quota_usage(connection_id, quota_kind, window_end);

CREATE TABLE IF NOT EXISTS social_publish_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_handle TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  token_ref TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_publish_connections_provider_status
  ON social_publish_connections(provider, status);
