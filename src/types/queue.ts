/**
 * Queue Message Types
 *
 * These types represent the messages sent through the fanout queue
 * and the event envelopes used throughout the system.
 */

import { PrivacyScopeT, SourceAppT, BlobRefT } from "../types";

/**
 * Event envelope as received by queue consumers
 * This is the canonical format for events flowing through the system
 */
export interface QueueEventEnvelope {
  eventId: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestamp: number;
  privacyScope: PrivacyScopeT;
  consentScope?: string;
  consentVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  blobRefs?: BlobRefT[];
  traceId?: string;
  /** Legacy field - alias for userId */
  clerkUserId?: string;
  /** Tenant ID for multi-tenant deployments */
  tenantId?: string;
  _requeue?: {
    reason: string;
    requeueCount: number;
    targets: string[];
  };
}

/**
 * Social signal - reduced event for social backend
 */
export interface SocialSignal {
  userId: string;
  eventType: string;
  timestamp: number;
  privacyScope: PrivacyScopeT;
  category: string | null;
}

/**
 * JWT payload structure for Clerk tokens
 */
export interface JwtPayload {
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

/**
 * JWT header structure
 */
export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

/**
 * Parsed JWT structure
 */
export interface ParsedJwt {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Uint8Array;
}

/**
 * Response from ops client proxy calls
 */
export interface OpsProxyResponse {
  status: number;
  json: unknown;
  text: string;
}

/**
 * Generic JSON-serializable value
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Generic record with unknown values (safer than Record<string, any>)
 */
export type JsonRecord = Record<string, unknown>;
