-- =============================================================================
-- Migration: 0007_rename_delivery_columns.sql
-- Version: 2.2.0
-- Date: 2026-01-14
--
-- Purpose: Rename delivery status columns to match db/schema.sql and d1.ts
-- expectations. The original migrations used snake_case names like
-- `convex_delivery_status` but the consolidated schema and TypeScript code
-- expect camelCase names like `toConvexStatus`.
--
-- This migration brings the actual D1 database in line with the expected
-- column names used by the Worker code.
--
-- Note: D1 uses SQLite 3.45+ which supports ALTER TABLE RENAME COLUMN.
-- =============================================================================

-- =============================================================================
-- Rename Convex delivery columns
-- =============================================================================
-- From 0001_d1.sql: delivered_to_convex_at_ms, convex_delivery_status, convex_delivery_error
-- From 0002_enhanced: convex_attempts, convex_last_attempt_at_ms, convex_http_status

ALTER TABLE events RENAME COLUMN convex_delivery_status TO toConvexStatus;
ALTER TABLE events RENAME COLUMN delivered_to_convex_at_ms TO toConvexAtMs;
ALTER TABLE events RENAME COLUMN convex_delivery_error TO toConvexLastError;
ALTER TABLE events RENAME COLUMN convex_attempts TO toConvexAttempts;
ALTER TABLE events RENAME COLUMN convex_last_attempt_at_ms TO toConvexLastAttemptAtMs;
ALTER TABLE events RENAME COLUMN convex_http_status TO toConvexHttpStatus;

-- =============================================================================
-- Rename Brain delivery columns
-- =============================================================================
-- From 0002_enhanced: brain_delivery_status, brain_attempts, brain_last_attempt_at_ms,
--                     brain_delivered_at_ms, brain_http_status, brain_delivery_error,
--                     brain_skip_reason

ALTER TABLE events RENAME COLUMN brain_delivery_status TO toBrainStatus;
ALTER TABLE events RENAME COLUMN brain_delivered_at_ms TO toBrainAtMs;
ALTER TABLE events RENAME COLUMN brain_attempts TO toBrainAttempts;
ALTER TABLE events RENAME COLUMN brain_last_attempt_at_ms TO toBrainLastAttemptAtMs;
ALTER TABLE events RENAME COLUMN brain_http_status TO toBrainHttpStatus;
ALTER TABLE events RENAME COLUMN brain_delivery_error TO toBrainLastError;
ALTER TABLE events RENAME COLUMN brain_skip_reason TO toBrainSkipReason;

-- =============================================================================
-- Rename Social delivery columns
-- =============================================================================
-- From 0001_d1.sql: social_forwarded_at_ms, social_delivery_status, social_delivery_error
-- From 0002_enhanced: social_attempts, social_last_attempt_at_ms, social_http_status,
--                     social_skip_reason

ALTER TABLE events RENAME COLUMN social_delivery_status TO toSocialStatus;
ALTER TABLE events RENAME COLUMN social_forwarded_at_ms TO toSocialAtMs;
ALTER TABLE events RENAME COLUMN social_delivery_error TO toSocialLastError;
ALTER TABLE events RENAME COLUMN social_attempts TO toSocialAttempts;
ALTER TABLE events RENAME COLUMN social_last_attempt_at_ms TO toSocialLastAttemptAtMs;
ALTER TABLE events RENAME COLUMN social_http_status TO toSocialHttpStatus;
ALTER TABLE events RENAME COLUMN social_skip_reason TO toSocialSkipReason;

-- =============================================================================
-- Rename queue tracking columns
-- =============================================================================
-- From 0002_enhanced: queued_at_ms, queue_message_id, queue_attempts,
--                     queue_last_attempt_at_ms, queue_consumer_id, queue_lease_expires_at_ms

ALTER TABLE events RENAME COLUMN queued_at_ms TO queuedAtMs;
ALTER TABLE events RENAME COLUMN queue_message_id TO queueMessageId;
ALTER TABLE events RENAME COLUMN queue_attempts TO queueAttempts;
ALTER TABLE events RENAME COLUMN queue_last_attempt_at_ms TO queueLastAttemptAtMs;
ALTER TABLE events RENAME COLUMN queue_consumer_id TO queueConsumerId;
ALTER TABLE events RENAME COLUMN queue_lease_expires_at_ms TO queueLeaseExpiresAtMs;

-- =============================================================================
-- Rename admin ops columns
-- =============================================================================
-- From 0002_enhanced: requeue_count, last_requeue_at_ms, last_requeue_reason

ALTER TABLE events RENAME COLUMN requeue_count TO requeueCount;
ALTER TABLE events RENAME COLUMN last_requeue_at_ms TO lastRequeueAtMs;
ALTER TABLE events RENAME COLUMN last_requeue_reason TO lastRequeueReason;

-- =============================================================================
-- Rename core event columns to match schema.ts expectations
-- =============================================================================
-- Note: Some columns need to be renamed from snake_case to camelCase

ALTER TABLE events RENAME COLUMN user_id TO userId;
ALTER TABLE events RENAME COLUMN source_app TO sourceApp;
ALTER TABLE events RENAME COLUMN event_type TO eventType;
ALTER TABLE events RENAME COLUMN timestamp_ms TO timestampMs;
ALTER TABLE events RENAME COLUMN privacy_scope TO privacyScope;
ALTER TABLE events RENAME COLUMN consent_scope TO consentScope;
ALTER TABLE events RENAME COLUMN consent_version TO consentVersion;
ALTER TABLE events RENAME COLUMN idempotency_key TO idempotencyKey;
ALTER TABLE events RENAME COLUMN payload_json TO payloadJson;
ALTER TABLE events RENAME COLUMN blob_refs_json TO blobRefsJson;
ALTER TABLE events RENAME COLUMN received_at_ms TO receivedAtMs;

-- =============================================================================
-- Rename columns added in 0006 migration
-- =============================================================================
ALTER TABLE events RENAME COLUMN contracts_version TO contractsVersion;
ALTER TABLE events RENAME COLUMN payload_sha256 TO payloadSha256;
ALTER TABLE events RENAME COLUMN client_meta_json TO clientMetaJson;

-- =============================================================================
-- Rename tier/retention columns from 0002_add_tier_columns
-- =============================================================================
-- Note: retentionDays and expiresAtMs are already in camelCase

-- =============================================================================
-- Rename fanout columns from 0003_add_delivery_tracking
-- =============================================================================
-- Note: fanoutDestinations and fanoutCompletedAt are already in camelCase

-- =============================================================================
-- Update indexes to use new column names
-- =============================================================================
-- Drop old indexes and recreate with new column names

DROP INDEX IF EXISTS idx_events_user_time;
DROP INDEX IF EXISTS idx_events_type_time;
DROP INDEX IF EXISTS idx_events_received;
DROP INDEX IF EXISTS idx_events_source;
DROP INDEX IF EXISTS idx_events_delivery;
DROP INDEX IF EXISTS idx_events_brain_delivery;

CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(userId, timestampMs DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(eventType, timestampMs DESC);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(receivedAtMs DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(sourceApp, timestampMs DESC);
CREATE INDEX IF NOT EXISTS idx_events_convex_status ON events(toConvexStatus, toConvexAtMs);
CREATE INDEX IF NOT EXISTS idx_events_brain_status ON events(toBrainStatus, toBrainAtMs);
CREATE INDEX IF NOT EXISTS idx_events_social_status ON events(toSocialStatus, toSocialAtMs);

-- =============================================================================
-- Rename columns in other tables for consistency
-- =============================================================================

-- idempotency table
ALTER TABLE idempotency RENAME COLUMN user_id TO userId;
ALTER TABLE idempotency RENAME COLUMN idempotency_key TO idempotencyKey;
ALTER TABLE idempotency RENAME COLUMN event_id TO eventId;
ALTER TABLE idempotency RENAME COLUMN created_at_ms TO createdAtMs;

-- consents table (legacy)
ALTER TABLE consents RENAME COLUMN user_id TO userId;
ALTER TABLE consents RENAME COLUMN updated_at_ms TO updatedAtMs;

-- audit_log table
ALTER TABLE audit_log RENAME COLUMN at_ms TO atMs;
ALTER TABLE audit_log RENAME COLUMN user_id TO userId;

-- user_consents table (from 0006)
ALTER TABLE user_consents RENAME COLUMN user_id TO userId;
ALTER TABLE user_consents RENAME COLUMN consent_version TO consentVersion;
ALTER TABLE user_consents RENAME COLUMN scopes_json TO scopesJson;
ALTER TABLE user_consents RENAME COLUMN updated_at_ms TO updatedAtMs;

-- consent_state table (from 0006)
ALTER TABLE consent_state RENAME COLUMN user_id TO userId;
ALTER TABLE consent_state RENAME COLUMN consent_version TO consentVersion;
ALTER TABLE consent_state RENAME COLUMN scopes_json TO scopesJson;
ALTER TABLE consent_state RENAME COLUMN ultra_consent_ack TO ultraConsentAck;
ALTER TABLE consent_state RENAME COLUMN updated_at_ms TO updatedAtMs;

-- event_blobs table (from 0006)
ALTER TABLE event_blobs RENAME COLUMN event_id TO eventId;
ALTER TABLE event_blobs RENAME COLUMN r2_key TO r2Key;
ALTER TABLE event_blobs RENAME COLUMN content_type TO contentType;
ALTER TABLE event_blobs RENAME COLUMN size_bytes TO sizeBytes;
ALTER TABLE event_blobs RENAME COLUMN created_at_ms TO createdAtMs;

-- delivery_log table (from 0006)
ALTER TABLE delivery_log RENAME COLUMN event_id TO eventId;
ALTER TABLE delivery_log RENAME COLUMN attempt_number TO attemptNumber;
ALTER TABLE delivery_log RENAME COLUMN response_code TO responseCode;
ALTER TABLE delivery_log RENAME COLUMN response_body TO responseBody;
ALTER TABLE delivery_log RENAME COLUMN error_message TO errorMessage;
ALTER TABLE delivery_log RENAME COLUMN duration_ms TO durationMs;
ALTER TABLE delivery_log RENAME COLUMN created_at_ms TO createdAtMs;

-- profile_snapshots table (from 0002_profile_snapshots)
ALTER TABLE profile_snapshots RENAME COLUMN user_id TO userId;
ALTER TABLE profile_snapshots RENAME COLUMN questionnaire_id TO questionnaireId;
ALTER TABLE profile_snapshots RENAME COLUMN questionnaire_version TO questionnaireVersion;
ALTER TABLE profile_snapshots RENAME COLUMN answers_json TO answersJson;
ALTER TABLE profile_snapshots RENAME COLUMN answer_count TO answerCount;
ALTER TABLE profile_snapshots RENAME COLUMN source_app TO sourceApp;
ALTER TABLE profile_snapshots RENAME COLUMN updated_at_ms TO updatedAtMs;
ALTER TABLE profile_snapshots RENAME COLUMN created_at_ms TO createdAtMs;
ALTER TABLE profile_snapshots RENAME COLUMN event_id TO eventId;

-- profile_snapshot_history table
ALTER TABLE profile_snapshot_history RENAME COLUMN user_id TO userId;
ALTER TABLE profile_snapshot_history RENAME COLUMN questionnaire_id TO questionnaireId;
ALTER TABLE profile_snapshot_history RENAME COLUMN questionnaire_version TO questionnaireVersion;
ALTER TABLE profile_snapshot_history RENAME COLUMN answers_json TO answersJson;
ALTER TABLE profile_snapshot_history RENAME COLUMN answer_count TO answerCount;
ALTER TABLE profile_snapshot_history RENAME COLUMN source_app TO sourceApp;
ALTER TABLE profile_snapshot_history RENAME COLUMN event_id TO eventId;
ALTER TABLE profile_snapshot_history RENAME COLUMN created_at_ms TO createdAtMs;

-- delivery_logs table (from 0003 - plural, keeping for compatibility)
ALTER TABLE delivery_logs RENAME COLUMN createdAtMs TO createdAtMs;
-- Note: delivery_logs already uses camelCase for some columns per 0003

-- =============================================================================
-- Update remaining indexes
-- =============================================================================
DROP INDEX IF EXISTS idx_consents_user;
DROP INDEX IF EXISTS idx_audit_time;
DROP INDEX IF EXISTS idx_audit_user;
DROP INDEX IF EXISTS idx_snapshots_user;
DROP INDEX IF EXISTS idx_snapshots_questionnaire;
DROP INDEX IF EXISTS idx_snapshots_updated;
DROP INDEX IF EXISTS idx_snapshot_history_user;
DROP INDEX IF EXISTS idx_snapshot_history_questionnaire;

CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(userId);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(atMs DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(userId, atMs DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON profile_snapshots(userId);
CREATE INDEX IF NOT EXISTS idx_snapshots_questionnaire ON profile_snapshots(questionnaireId, updatedAtMs DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_updated ON profile_snapshots(updatedAtMs DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_history_user ON profile_snapshot_history(userId, createdAtMs DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_history_questionnaire ON profile_snapshot_history(questionnaireId, createdAtMs DESC);
