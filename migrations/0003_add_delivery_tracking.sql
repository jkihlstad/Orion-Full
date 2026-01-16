-- ==============================================
-- Enhanced delivery tracking
-- Migration: 0003_add_delivery_tracking
-- ==============================================

-- Delivery logs table for detailed fanout tracking
CREATE TABLE IF NOT EXISTS delivery_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId TEXT NOT NULL,
  destination TEXT NOT NULL,          -- "convex"|"brain"|"social"
  status TEXT NOT NULL,               -- "pending"|"success"|"failed"
  attemptNumber INTEGER NOT NULL DEFAULT 1,
  responseCode INTEGER,
  responseBody TEXT,
  errorMessage TEXT,
  durationMs INTEGER,
  createdAtMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_event
  ON delivery_logs(eventId);

CREATE INDEX IF NOT EXISTS idx_delivery_status
  ON delivery_logs(status, createdAtMs DESC);

-- Add fanout destination tracking to events
ALTER TABLE events ADD COLUMN fanoutDestinations TEXT;  -- JSON array: ["convex","brain"]
ALTER TABLE events ADD COLUMN fanoutCompletedAt TEXT;   -- JSON object: {"convex":123456789}
