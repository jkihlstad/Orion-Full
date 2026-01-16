/**
 * errors.ts
 *
 * Standard gateway error codes and shapes for consistent client handling
 */

export enum ErrorCode {
  // Event validation errors
  UNKNOWN_EVENT_TYPE = 'UNKNOWN_EVENT_TYPE',
  EVENT_TYPE_DISABLED = 'EVENT_TYPE_DISABLED',
  INVALID_SCHEMA = 'INVALID_SCHEMA',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Consent errors
  FORBIDDEN_SCOPE = 'FORBIDDEN_SCOPE',
  ULTRA_CONSENT_REQUIRED = 'ULTRA_CONSENT_REQUIRED',
  CONSENT_VERSION_MISMATCH = 'CONSENT_VERSION_MISMATCH',

  // Context errors
  CAPTURE_CONTEXT_VIOLATION = 'CAPTURE_CONTEXT_VIOLATION',
  TIER_BACKGROUND_NOT_ALLOWED = 'TIER_BACKGROUND_NOT_ALLOWED',
  MISSING_CLIENT_META = 'MISSING_CLIENT_META',

  // Duplicate/replay errors
  REPLAY_DETECTED = 'REPLAY_DETECTED',
  DUPLICATE_EVENT_ID = 'DUPLICATE_EVENT_ID',

  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',

  // Server errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface ErrorDetails {
  eventType?: string;
  eventId?: string;
  missingScopes?: string[];
  requiredScopes?: string[];
  tier?: string;
  field?: string;
  expected?: string;
  received?: string;
  requiresIndicator?: boolean;
  retryAfter?: number;
  [key: string]: unknown;
}

export class GatewayError extends Error {
  public readonly code: ErrorCode;
  public readonly details: ErrorDetails;
  public readonly httpStatus: number;
  public readonly userMessage: string;

  constructor(
    code: ErrorCode,
    message: string,
    details: ErrorDetails = {}
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.details = details;
    this.httpStatus = getHttpStatusForCode(code);
    this.userMessage = getUserMessageForCode(code, details);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        userMessage: this.userMessage,
        details: this.details,
      },
    };
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.httpStatus,
      headers: {
        'Content-Type': 'application/json',
        ...(this.details.retryAfter ? { 'Retry-After': String(this.details.retryAfter) } : {}),
      },
    });
  }
}

function getHttpStatusForCode(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.UNKNOWN_EVENT_TYPE:
    case ErrorCode.EVENT_TYPE_DISABLED:
    case ErrorCode.INVALID_SCHEMA:
    case ErrorCode.MISSING_REQUIRED_FIELD:
    case ErrorCode.CAPTURE_CONTEXT_VIOLATION:
    case ErrorCode.TIER_BACKGROUND_NOT_ALLOWED:
    case ErrorCode.MISSING_CLIENT_META:
    case ErrorCode.CONSENT_VERSION_MISMATCH:
      return 400;

    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.TOKEN_EXPIRED:
      return 401;

    case ErrorCode.FORBIDDEN:
    case ErrorCode.FORBIDDEN_SCOPE:
    case ErrorCode.ULTRA_CONSENT_REQUIRED:
      return 403;

    case ErrorCode.REPLAY_DETECTED:
    case ErrorCode.DUPLICATE_EVENT_ID:
      return 409;

    case ErrorCode.RATE_LIMITED:
      return 429;

    case ErrorCode.INTERNAL_ERROR:
      return 500;

    case ErrorCode.SERVICE_UNAVAILABLE:
      return 503;

    default:
      return 500;
  }
}

function getUserMessageForCode(code: ErrorCode, details: ErrorDetails): string {
  switch (code) {
    case ErrorCode.UNKNOWN_EVENT_TYPE:
      return `Unknown event type: ${details.eventType}. Please update your app.`;

    case ErrorCode.EVENT_TYPE_DISABLED:
      return `This feature is currently disabled.`;

    case ErrorCode.FORBIDDEN_SCOPE:
      return `This action requires additional permissions. Please enable: ${details.missingScopes?.join(', ')}`;

    case ErrorCode.ULTRA_CONSENT_REQUIRED:
      return `This feature requires explicit acknowledgment due to its sensitivity.`;

    case ErrorCode.CAPTURE_CONTEXT_VIOLATION:
      return `This data can only be captured while the app is active or with a recording indicator visible.`;

    case ErrorCode.TIER_BACKGROUND_NOT_ALLOWED:
      return `This feature cannot be used in the background.`;

    case ErrorCode.REPLAY_DETECTED:
      return `This event has already been processed.`;

    case ErrorCode.RATE_LIMITED:
      return `Too many requests. Please wait ${details.retryAfter || 60} seconds.`;

    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.TOKEN_EXPIRED:
      return `Please sign in again.`;

    case ErrorCode.INTERNAL_ERROR:
    case ErrorCode.SERVICE_UNAVAILABLE:
      return `Something went wrong. Please try again later.`;

    default:
      return `An error occurred. Please try again.`;
  }
}

/**
 * Create error response for Debug Banner display
 */
export function createDebugBannerError(error: GatewayError): object {
  return {
    banner: {
      type: 'error',
      code: error.code,
      title: getDebugBannerTitle(error.code),
      message: error.userMessage,
      details: error.details,
      actions: getDebugBannerActions(error.code, error.details),
    },
  };
}

function getDebugBannerTitle(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.FORBIDDEN_SCOPE:
      return 'Permission Required';
    case ErrorCode.CAPTURE_CONTEXT_VIOLATION:
      return 'Capture Blocked';
    case ErrorCode.TIER_BACKGROUND_NOT_ALLOWED:
      return 'Background Not Allowed';
    case ErrorCode.RATE_LIMITED:
      return 'Rate Limited';
    case ErrorCode.REPLAY_DETECTED:
      return 'Duplicate Event';
    default:
      return 'Error';
  }
}

function getDebugBannerActions(code: ErrorCode, details: ErrorDetails): object[] {
  switch (code) {
    case ErrorCode.FORBIDDEN_SCOPE:
      return [
        { label: 'Open Settings', action: 'openConsentSettings' },
        { label: 'Dismiss', action: 'dismiss' },
      ];
    case ErrorCode.CAPTURE_CONTEXT_VIOLATION:
      return [
        { label: 'Bring to Foreground', action: 'bringToForeground' },
        { label: 'Dismiss', action: 'dismiss' },
      ];
    case ErrorCode.RATE_LIMITED:
      return [
        { label: `Retry in ${details.retryAfter}s`, action: 'retryLater' },
      ];
    default:
      return [
        { label: 'Dismiss', action: 'dismiss' },
      ];
  }
}
