/**
 * Database Row Types for D1
 *
 * These types represent the raw rows returned from D1 database queries.
 * They use snake_case naming to match the database schema.
 */

/**
 * Raw event row from D1 events table
 */
export interface EventRow {
  id: string;
  user_id: string;
  source_app: string;
  event_type: string;
  timestamp_ms: number;
  privacy_scope: string;
  consent_scope: string | null;
  consent_version: string;
  idempotency_key: string;
  payload_json: string | null;
  blob_refs_json: string | null;
  received_at_ms: number | null;
  trace_id: string | null;

  // Delivery status fields
  convex_delivery_status: string | null;
  delivered_to_convex_at_ms: number | null;
  convex_delivery_error: string | null;
  convex_attempts?: number;

  brain_delivery_status: string | null;
  brain_delivered_at_ms: number | null;
  brain_delivery_error: string | null;
  brain_attempts?: number;

  social_delivery_status: string | null;
  social_forwarded_at_ms: number | null;
  social_delivery_error: string | null;
  social_attempts?: number;

  // Requeue tracking
  requeue_count?: number;
  last_requeue_at_ms?: number | null;
  last_requeue_reason?: string | null;
  queued_at_ms?: number | null;

  // Blob count
  blob_count?: number;
}

/**
 * Partial event row for delivery status queries
 */
export interface EventDeliveryRow {
  id: string;
  user_id: string;
  source_app: string;
  event_type: string;
  timestamp_ms: number;
  privacy_scope: string;
  convex_delivery_status: string | null;
  brain_delivery_status: string | null;
  social_delivery_status: string | null;
  convex_delivery_error: string | null;
  brain_delivery_error: string | null;
  social_delivery_error: string | null;
}

/**
 * Computed delivery status values
 */
export type DeliveryStatusValue = "pending" | "delivered" | "failed" | "skipped" | "ok" | "done";

/**
 * SQL bind values - allowed types for D1 prepared statements
 */
export type SqlBindValue = string | number | null;
