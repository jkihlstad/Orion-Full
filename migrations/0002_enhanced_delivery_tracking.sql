-- Orion Edge Gateway D1 Schema Migration
-- Version: 1.1.0
-- Description: Add enhanced delivery tracking columns to events table

-- ============================================================================
-- Queue tracking columns
-- ============================================================================
ALTER TABLE events ADD COLUMN queued_at_ms INTEGER;
ALTER TABLE events ADD COLUMN queue_message_id TEXT;
ALTER TABLE events ADD COLUMN queue_attempts INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN queue_last_attempt_at_ms INTEGER;
ALTER TABLE events ADD COLUMN queue_consumer_id TEXT;
ALTER TABLE events ADD COLUMN queue_lease_expires_at_ms INTEGER;

-- ============================================================================
-- Enhanced ingestion (convex) tracking columns
-- ============================================================================
ALTER TABLE events ADD COLUMN convex_attempts INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN convex_last_attempt_at_ms INTEGER;
ALTER TABLE events ADD COLUMN convex_http_status INTEGER;

-- ============================================================================
-- Brain delivery tracking columns
-- ============================================================================
ALTER TABLE events ADD COLUMN brain_delivery_status TEXT DEFAULT 'pending';
ALTER TABLE events ADD COLUMN brain_attempts INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN brain_last_attempt_at_ms INTEGER;
ALTER TABLE events ADD COLUMN brain_delivered_at_ms INTEGER;
ALTER TABLE events ADD COLUMN brain_http_status INTEGER;
ALTER TABLE events ADD COLUMN brain_delivery_error TEXT;
ALTER TABLE events ADD COLUMN brain_skip_reason TEXT;

-- ============================================================================
-- Enhanced social delivery tracking columns
-- ============================================================================
ALTER TABLE events ADD COLUMN social_attempts INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN social_last_attempt_at_ms INTEGER;
ALTER TABLE events ADD COLUMN social_http_status INTEGER;
ALTER TABLE events ADD COLUMN social_skip_reason TEXT;

-- ============================================================================
-- Admin ops columns
-- ============================================================================
ALTER TABLE events ADD COLUMN requeue_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN last_requeue_at_ms INTEGER;
ALTER TABLE events ADD COLUMN last_requeue_reason TEXT;

-- ============================================================================
-- Additional indexes for enhanced delivery tracking
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_events_brain_delivery ON events(brain_delivery_status);
CREATE INDEX IF NOT EXISTS idx_events_queue_attempts ON events(queue_attempts);
CREATE INDEX IF NOT EXISTS idx_events_requeue ON events(requeue_count);
