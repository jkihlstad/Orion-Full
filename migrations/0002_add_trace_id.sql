-- Migration: Add trace_id column for golden flow tests
-- Version: 1.1.0
-- Date: 2026-01-11
--
-- This migration adds a trace_id column to the events table to support
-- end-to-end tracing through the event pipeline for testing and debugging.

-- Add trace_id column to events table
ALTER TABLE events ADD COLUMN trace_id TEXT;

-- Create index for efficient lookup by trace_id
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
