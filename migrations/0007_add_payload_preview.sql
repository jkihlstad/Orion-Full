-- =============================================================================
-- Migration: 0007_add_payload_preview.sql
-- Version: 2.2.0
-- Date: 2026-01-14
--
-- Purpose: Add payload_preview_json column to events table.
-- This column stores a lightweight preview of the event payload for
-- timeline/search cards and quick inspection without parsing full payload.
--
-- The d1InsertEventWithDedupe function expects this column to exist.
-- Previously, the preview was incorrectly being written to blob_refs_json.
-- =============================================================================

-- Add payload_preview_json column for lightweight event previews
ALTER TABLE events ADD COLUMN payload_preview_json TEXT;

-- Optional index for future search/filter on preview content
-- CREATE INDEX IF NOT EXISTS idx_events_preview ON events(payload_preview_json) WHERE payload_preview_json IS NOT NULL;
