-- Migration: 0005_add_traceId_index.sql
-- Window 93: Gateway traceId guarantee
--
-- Adds an index on the trace_id column in the events table
-- to support efficient lookups for debug/trace queries.
--
-- The trace_id column was added in a previous migration (0003 or 0004)
-- for golden flow testing. This index optimizes queries like:
-- - GET /v1/debug/trace?traceId=...
-- - GET /v1/events/list?traceId=...
-- - GET /v1/admin/delivery/status?traceId=...
--
-- Performance impact:
-- - Slight overhead on INSERT (index maintenance)
-- - Significant speedup on trace_id queries (O(log n) vs O(n))
-- - Estimated index size: ~50 bytes per row

CREATE INDEX IF NOT EXISTS idx_events_traceId ON events(trace_id);

-- Note: The trace_id column should already exist. If it doesn't,
-- uncomment the following ALTER TABLE statement:
--
-- ALTER TABLE events ADD COLUMN trace_id TEXT;
