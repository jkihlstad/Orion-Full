-- ==============================================
-- Add privacy tier tracking
-- Migration: 0002_add_tier_columns
-- ==============================================

-- Add tier column to events (T0, T1, T2, T3)
ALTER TABLE events ADD COLUMN tier TEXT DEFAULT 'T1';

-- Add index for tier-based queries
CREATE INDEX IF NOT EXISTS idx_events_tier
  ON events(tier, timestamp_ms DESC);

-- Add retention tracking
ALTER TABLE events ADD COLUMN retentionDays INTEGER DEFAULT 365;
ALTER TABLE events ADD COLUMN expiresAtMs INTEGER;

-- Index for retention cleanup
CREATE INDEX IF NOT EXISTS idx_events_expires
  ON events(expiresAtMs);
