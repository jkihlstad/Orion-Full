-- Orion Edge Gateway D1 Schema
-- Version: 1.0.0

-- ============================================================================
-- Events: canonical event log with delivery tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                     -- eventId (uuid)
  user_id TEXT NOT NULL,                   -- clerkUserId
  source_app TEXT NOT NULL,                -- finance, browser, dating, etc.
  event_type TEXT NOT NULL,                -- domain.action format
  timestamp_ms INTEGER NOT NULL,           -- event timestamp
  privacy_scope TEXT NOT NULL,             -- private|social|public
  consent_scope TEXT,                      -- from registry.json
  consent_version TEXT NOT NULL,           -- user's consent version
  idempotency_key TEXT NOT NULL,           -- client-provided dedup key
  payload_json TEXT NOT NULL,              -- redacted payload
  blob_refs_json TEXT,                     -- JSON array of blob refs
  received_at_ms INTEGER NOT NULL,         -- gateway receive time

  -- Delivery tracking
  delivered_to_convex_at_ms INTEGER,
  convex_delivery_status TEXT DEFAULT 'pending',  -- pending|ok|failed
  convex_delivery_error TEXT,
  social_forwarded_at_ms INTEGER,
  social_delivery_status TEXT DEFAULT 'pending',  -- pending|ok|failed|skipped
  social_delivery_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_app, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_events_delivery ON events(convex_delivery_status, social_delivery_status);

-- ============================================================================
-- Idempotency: durable dedupe and replay protection
-- ============================================================================
CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

-- ============================================================================
-- Consents: user consent preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS consents (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,     -- 0=false, 1=true
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id);

-- ============================================================================
-- Audit log: admin actions and system events
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at_ms DESC);
