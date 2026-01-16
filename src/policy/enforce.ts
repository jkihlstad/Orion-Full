/**
 * enforce.ts
 *
 * Policy enforcement for event ingestion
 */

import { getEventRequirements, isKnownEventType, isEventEnabled, EventRequirement } from './requirements';
import { GatewayError, ErrorCode } from '../routes/errors';

export interface ClientMeta {
  isForeground: boolean;
  hasIndicator: boolean;
  capturedAt: string;
  appState?: string;
  batteryLevel?: number;
  networkType?: string;
}

export interface EventEnvelope {
  eventId: string;
  eventType: string;
  sourceApp: string;
  traceId: string;
  timestamp: string;
  consentVersion: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  blobRef?: {
    blobId: string;
    mimeType: string;
    size: number;
    sha256: string;
  };
  metadata?: Record<string, unknown>;
  clientMeta?: ClientMeta;
}

export interface UserConsent {
  userId: string;
  enabledScopes: string[];
  consentVersion: string;
  ultraConsentAcknowledged?: boolean;
}

export interface EnforcementResult {
  allowed: boolean;
  error?: GatewayError;
  requirements?: EventRequirement;
  warnings?: string[];
}

/**
 * Enforce all policies for an event
 */
export function enforceEventPolicy(
  event: EventEnvelope,
  userConsent: UserConsent
): EnforcementResult {
  const warnings: string[] = [];

  // 1. Check if event type is known
  if (!isKnownEventType(event.eventType)) {
    return {
      allowed: false,
      error: new GatewayError(
        ErrorCode.UNKNOWN_EVENT_TYPE,
        `Unknown event type: ${event.eventType}`,
        { eventType: event.eventType }
      ),
    };
  }

  // 2. Check if event type is enabled
  if (!isEventEnabled(event.eventType)) {
    return {
      allowed: false,
      error: new GatewayError(
        ErrorCode.EVENT_TYPE_DISABLED,
        `Event type is disabled: ${event.eventType}`,
        { eventType: event.eventType }
      ),
    };
  }

  const requirements = getEventRequirements(event.eventType)!;

  // 3. Check required scopes
  const missingScopes = requirements.requiredScopes.filter(
    scope => !userConsent.enabledScopes.includes(scope)
  );

  if (missingScopes.length > 0) {
    return {
      allowed: false,
      error: new GatewayError(
        ErrorCode.FORBIDDEN_SCOPE,
        `Missing required consent scopes`,
        {
          eventType: event.eventType,
          missingScopes,
          requiredScopes: requirements.requiredScopes
        }
      ),
      requirements,
    };
  }

  // 4. Check ultra consent for T3 events
  if (requirements.requiresUltraConsent && !userConsent.ultraConsentAcknowledged) {
    return {
      allowed: false,
      error: new GatewayError(
        ErrorCode.ULTRA_CONSENT_REQUIRED,
        `Event requires ultra consent acknowledgment`,
        { eventType: event.eventType, tier: requirements.tier }
      ),
      requirements,
    };
  }

  // 5. Check capture context (foreground/background)
  const clientMeta = event.clientMeta;

  if (requirements.tier === 'T3' && requirements.allowBackground === false) {
    if (!clientMeta?.isForeground) {
      return {
        allowed: false,
        error: new GatewayError(
          ErrorCode.TIER_BACKGROUND_NOT_ALLOWED,
          `T3 events cannot be captured in background`,
          { eventType: event.eventType, tier: 'T3' }
        ),
        requirements,
      };
    }
  }

  // 6. Check indicator requirement for background T2+ events
  if (requirements.requiresIndicatorInBackground && !clientMeta?.isForeground) {
    if (!clientMeta?.hasIndicator) {
      return {
        allowed: false,
        error: new GatewayError(
          ErrorCode.CAPTURE_CONTEXT_VIOLATION,
          `Background capture requires recording indicator`,
          {
            eventType: event.eventType,
            tier: requirements.tier,
            requiresIndicator: true
          }
        ),
        requirements,
      };
    }
  }

  // 7. Warn if clientMeta is missing (but don't reject for now)
  if (!clientMeta) {
    warnings.push('clientMeta not provided - context validation skipped');
  }

  return {
    allowed: true,
    requirements,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Get redaction keys for an event type
 */
export function getRedactionKeys(eventType: string): string[] {
  const requirements = getEventRequirements(eventType);
  return requirements?.redactKeys ?? [];
}

/**
 * Check if event requires graph processing
 */
export function requiresGraphProcessing(eventType: string): boolean {
  const requirements = getEventRequirements(eventType);
  return requirements?.graphRequired ?? false;
}

/**
 * Check if event should be sent to Brain
 */
export function shouldSendToBrain(eventType: string): boolean {
  const requirements = getEventRequirements(eventType);
  return requirements?.brainEnabled ?? false;
}

/**
 * Get retention days for an event type
 */
export function getRetentionDays(eventType: string): number {
  const requirements = getEventRequirements(eventType);
  return requirements?.retentionDays ?? 365;
}
