-- =============================================================================
-- Migration: 0006_expand_events_and_consents.sql
-- Version: 2.1.0
-- Date: 2026-01-14
--
-- Purpose: Fix schema drift between migrations, schema.ts, and Worker code.
-- This migration adds missing columns and tables that the TypeScript types
-- expect but that were not created in previous migrations.
--
-- Changes:
-- 1. Add missing columns to events table (contracts_version, payload_sha256,
--    client_meta_json, status) that schema.ts expects
-- 2. Create user_consents table for bulk consent storage (Window 25)
-- 3. Create consent_state table for ConsentStateRow compatibility
-- 4. Create event_blobs table for blob reference tracking (Window 23)
-- 5. Create delivery_log table to match DeliveryLogRow in schema.ts
-- =============================================================================

-- =============================================================================
-- Add missing columns to events table
-- =============================================================================

-- contracts_version: Version of the suite-contracts used when event was emitted
ALTER TABLE events ADD COLUMN contracts_version TEXT;

-- payload_sha256: SHA-256 hash of the original payload for integrity/provenance
ALTER TABLE events ADD COLUMN payload_sha256 TEXT;

-- client_meta_json: On-device metadata (foreground state, battery, network, etc.)
-- Used for Timeline UX and provenance evidence
ALTER TABLE events ADD COLUMN client_meta_json TEXT;

-- status: Generic status field for ops/fanout endpoints
-- Values: accepted | queued | delivered | failed
ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'accepted';

-- =============================================================================
-- Create user_consents table (Window 25 - bulk consent storage)
-- =============================================================================
-- The legacy 'consents' table stores one row per scope.
-- This table stores the entire consent object as JSON for efficiency.
-- d1.ts expects this table via d1GetUserConsents/d1SetUserConsents.
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_consents (
  user_id TEXT PRIMARY KEY,
  consent_version TEXT NOT NULL,
  scopes_json TEXT NOT NULL,              -- JSON object: { "scope.key": true/false, ... }
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_consents_updated ON user_consents(updated_at_ms DESC);

-- =============================================================================
-- Create consent_state table (ConsentStateRow compatibility)
-- =============================================================================
-- This table supports the richer ConsentStateRow interface from schema.ts
-- which includes ultraConsentAcknowledged for "ultra consent" flow tracking.
-- =============================================================================
CREATE TABLE IF NOT EXISTS consent_state (
  user_id TEXT PRIMARY KEY,
  consent_version TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  ultra_consent_ack INTEGER NOT NULL DEFAULT 0,  -- 0=false, 1=true
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_state_updated ON consent_state(updated_at_ms DESC);

-- =============================================================================
-- Create event_blobs table (Window 23 - blob reference tracking)
-- =============================================================================
-- Links events to R2 blob references for audit trail.
-- Used by d1InsertEventBlobs, d1GetEventBlobs, d1GetEventsByBlobKey.
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_blobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_blobs_event ON event_blobs(event_id);
CREATE INDEX IF NOT EXISTS idx_event_blobs_r2key ON event_blobs(r2_key);

-- =============================================================================
-- Create delivery_log table (DeliveryLogRow compatibility)
-- =============================================================================
-- Note: Migration 0003 creates 'delivery_logs' (plural) but schema.ts
-- defines DeliveryLogRow for 'delivery_log' (singular).
-- This creates the singular version for compatibility.
-- =============================================================================
CREATE TABLE IF NOT EXISTS delivery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL,            -- convex | brain | social
  status TEXT NOT NULL,                 -- pending | success | failed
  attempt_number INTEGER NOT NULL DEFAULT 1,
  response_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_event ON delivery_log(event_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_log_status ON delivery_log(status, created_at_ms DESC);

-- =============================================================================
-- Add indexes for new columns
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, received_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_events_contracts_version ON events(contracts_version);
