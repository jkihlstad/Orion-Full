-- Orion Edge Gateway D1 Schema - Profile Snapshots
-- Version: 2.0.0
--
-- This migration adds support for storing questionnaire snapshots from iOS apps.
-- These snapshots are used for Brain personalization and cross-app profile sync.

-- ============================================================================
-- Profile Snapshots: questionnaire answers synced from iOS apps
-- ============================================================================
-- Stores the latest snapshot of each questionnaire per user.
-- iOS apps emit profile.avatar_snapshot_updated or profile.app_snapshot_updated
-- events when questionnaires are saved, which populate this table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS profile_snapshots (
  user_id TEXT NOT NULL,                         -- clerkUserId
  questionnaire_id TEXT NOT NULL,                -- e.g., "avatar.core.v1", "email.prefs.v1"
  questionnaire_version INTEGER NOT NULL,        -- spec version
  answers_json TEXT NOT NULL,                    -- JSON object of questionId -> AnswerValue
  answer_count INTEGER NOT NULL DEFAULT 0,       -- number of answers (for quick stats)
  source_app TEXT NOT NULL,                      -- which app submitted this snapshot
  updated_at_ms INTEGER NOT NULL,                -- when this snapshot was received
  created_at_ms INTEGER NOT NULL,                -- when first created
  event_id TEXT,                                 -- reference to the event that created this
  PRIMARY KEY (user_id, questionnaire_id)
);

-- Index for listing all snapshots for a user
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON profile_snapshots(user_id);

-- Index for finding snapshots by questionnaire type (admin/analytics)
CREATE INDEX IF NOT EXISTS idx_snapshots_questionnaire ON profile_snapshots(questionnaire_id, updated_at_ms DESC);

-- Index for finding recent updates (for sync checks)
CREATE INDEX IF NOT EXISTS idx_snapshots_updated ON profile_snapshots(updated_at_ms DESC);

-- ============================================================================
-- Profile Snapshot History: audit trail of all snapshot updates
-- ============================================================================
-- Optional: Keep history of all snapshot updates for audit/debugging.
-- This is append-only and can be used for compliance/debugging.
-- ============================================================================
CREATE TABLE IF NOT EXISTS profile_snapshot_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  questionnaire_id TEXT NOT NULL,
  questionnaire_version INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  answer_count INTEGER NOT NULL,
  source_app TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_history_user ON profile_snapshot_history(user_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_history_questionnaire ON profile_snapshot_history(questionnaire_id, created_at_ms DESC);
