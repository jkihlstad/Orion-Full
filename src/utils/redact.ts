/**
 * Payload Redaction Helper (Window 15)
 *
 * Redacts sensitive fields from event payloads before storage and display.
 * Uses allow-list templates per app to ensure Dashboard stays safe.
 *
 * Sensitivity Levels:
 * - low: Return payload as-is (still remove token-like keys)
 * - med: Return allow-list fields only
 * - high: Strict allow-list only + hash fields if needed
 */

// ============================================================================
// Default Redact Keys (always stripped regardless of level)
// ============================================================================
const ALWAYS_REDACT_KEYS = new Set([
  // Auth/secrets
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "password",
  "secret",
  "apiKey",
  "api_key",
  "bearer",
  "public_token",
  "item_id",

  // Finance sensitive
  "accountNumber",
  "routingNumber",
  "pan",
  "cardNumber",
  "ssn",
  "dob",

  // Privacy sensitive
  "phoneNumber",
  "emailAddress",
  "address",
  "fullName",

  // Raw content
  "messageBody",
  "transcription",
  "audioData",
  "formData",
  "inputValue",
  "keyData",
  "rawBody",
  "body",
]);

// ============================================================================
// Allow-list Templates per App (Window 15.5)
// ============================================================================

/**
 * Browser allow-list (low-med sensitivity)
 */
const BROWSER_ALLOW_LIST = new Set([
  "url",
  "host",
  "title",
  "domain",
  "pathHash",
  "titleHash",
  "referrerDomain",
  "referrerHost",
  "tabId",
  "windowId",
  "viewDurationMs",
  "transitionType",
  "isNewTab",
  "isSecure",
  "contentType",
  "loadTimeMs",
  "incognito",
]);

/**
 * Finance allow-list (high sensitivity)
 */
const FINANCE_ALLOW_LIST = new Set([
  // Transaction fields
  "transactionId",
  "amount",
  "currency",
  "merchant",
  "merchantNormalized",
  "category",
  "subcategory",
  "transactionDate",
  "transactionType",
  "paymentChannel",
  "pending",

  // Subscription fields
  "cadence",
  "confidence",

  // Account info (masked)
  "institutionName",
  "accountLast4",
  "accountsCount",
  "accountRef",
]);

/**
 * Calendar allow-list (med sensitivity)
 */
const CALENDAR_ALLOW_LIST = new Set([
  "eventId",
  "calendarId",
  "title",
  "startTime",
  "endTime",
  "startMs",
  "endMs",
  "timezone",
  "isAllDay",
  "location",
  "status",
  "isRecurring",
  "attendeeCount",
  "source",
  "conferenceProvider",
  "responseStatus",
]);

/**
 * Tasks allow-list (low sensitivity)
 */
const TASKS_ALLOW_LIST = new Set([
  "taskId",
  "title",
  "dueDate",
  "dueMs",
  "dueTime",
  "dueDateTime",
  "startDate",
  "completedAtMs",
  "status",
  "priority",
  "listId",
  "projectId",
  "project",
  "tags",
  "labels",
  "isRecurring",
  "estimatedMinutes",
  "energy",
  "context",
  "source",
]);

/**
 * Email allow-list (high sensitivity)
 */
const EMAIL_ALLOW_LIST = new Set([
  "messageId",
  "threadId",
  "subject", // Only if consent
  "subjectHash",
  "fromDomain",
  "toDomains",
  "recipientCount",
  "toCount",
  "ccCount",
  "bccCount",
  "hasAttachments",
  "attachmentCount",
  "isReply",
  "isForward",
  "priority",
  "provider",
  "accountRef",
  "labels",
]);

// Map source apps to their allow-lists
const APP_ALLOW_LISTS: Record<string, Set<string>> = {
  browser: BROWSER_ALLOW_LIST,
  finance: FINANCE_ALLOW_LIST,
  calendar: CALENDAR_ALLOW_LIST,
  tasks: TASKS_ALLOW_LIST,
  email: EMAIL_ALLOW_LIST,
};

// Sensitivity levels per app
export type SensitivityLevel = "low" | "med" | "high";

const APP_SENSITIVITY: Record<string, SensitivityLevel> = {
  browser: "low",
  finance: "high",
  calendar: "med",
  tasks: "low",
  email: "high",
  dating: "med",
  social: "med",
  sleep: "low",
  workouts: "low",
};

// ============================================================================
// Redaction Functions
// ============================================================================

/**
 * Get sensitivity level for an event type or source app
 */
export function getSensitivity(eventType: string, sourceApp?: string): SensitivityLevel {
  // Check sourceApp first
  if (sourceApp && APP_SENSITIVITY[sourceApp]) {
    return APP_SENSITIVITY[sourceApp];
  }

  // Extract domain from eventType (e.g., "finance.transaction_created" -> "finance")
  const domain = eventType.split(".")[0];
  return APP_SENSITIVITY[domain] ?? "med";
}

/**
 * Get allow-list for a source app or event type
 */
export function getAllowList(eventType: string, sourceApp?: string): Set<string> | null {
  // Check sourceApp first
  if (sourceApp && APP_ALLOW_LISTS[sourceApp]) {
    return APP_ALLOW_LISTS[sourceApp];
  }

  // Extract domain from eventType
  const domain = eventType.split(".")[0];
  return APP_ALLOW_LISTS[domain] ?? null;
}

/**
 * Redact a single value if it contains sensitive patterns
 */
function redactValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Always redact known sensitive keys
  if (ALWAYS_REDACT_KEYS.has(key)) {
    return "[REDACTED]";
  }

  // Mask account-like fields (keep last 4)
  if (typeof value === "string" && key.toLowerCase().includes("account") && value.length > 6) {
    return "*".repeat(value.length - 4) + value.slice(-4);
  }

  return value;
}

/**
 * Recursively redact sensitive fields from an object
 */
function walkAndRedact(
  obj: unknown,
  allowList: Set<string> | null,
  sensitivity: SensitivityLevel,
  additionalRedactKeys: Set<string>
): unknown {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => walkAndRedact(item, allowList, sensitivity, additionalRedactKeys));
  }

  const result: Record<string, unknown> = {};
  const objRecord = obj as Record<string, unknown>;

  for (const [key, value] of Object.entries(objRecord)) {
    // Always redact known sensitive keys
    if (ALWAYS_REDACT_KEYS.has(key) || additionalRedactKeys.has(key)) {
      result[key] = "[REDACTED]";
      continue;
    }

    // For med/high sensitivity with allow-list, only include allowed fields
    if (sensitivity !== "low" && allowList && !allowList.has(key)) {
      // Skip non-allowed fields entirely for high sensitivity
      if (sensitivity === "high") {
        continue;
      }
      // For med, redact but keep the key
      result[key] = "[REDACTED]";
      continue;
    }

    // Recursively handle nested objects
    if (typeof value === "object" && value !== null) {
      result[key] = walkAndRedact(value, null, sensitivity, additionalRedactKeys);
    } else {
      result[key] = redactValue(key, value);
    }
  }

  return result;
}

/**
 * Redact payload for storage (called during event ingestion)
 *
 * @param payload - The raw event payload
 * @param additionalRedactKeys - Additional keys to redact from registry.json
 * @returns Redacted payload safe for storage
 */
export function redactPayload(
  payload: Record<string, unknown>,
  additionalRedactKeys: string[] = []
): Record<string, unknown> {
  const clone = structuredClone(payload) as Record<string, unknown>;
  const additionalSet = new Set(additionalRedactKeys);

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const objRecord = obj as Record<string, unknown>;
    for (const k of Object.keys(objRecord)) {
      const v = objRecord[k];
      if (ALWAYS_REDACT_KEYS.has(k) || additionalSet.has(k)) {
        objRecord[k] = "[REDACTED]";
      } else if (typeof v === "string" && k.toLowerCase().includes("account") && v.length > 6) {
        objRecord[k] = "*".repeat(v.length - 4) + v.slice(-4);
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  }

  walk(clone);
  return clone;
}

/**
 * Redact payload for Dashboard display (Window 15)
 *
 * This is the main function for preparing payloads for the Dashboard.
 * It uses app-specific allow-lists to ensure only safe fields are returned.
 *
 * @param payload - The stored payload (may already be partially redacted)
 * @param eventType - Event type (e.g., "finance.transaction_created")
 * @param sourceApp - Source application (e.g., "finance")
 * @param privacyScope - Privacy scope (private, social, public)
 * @returns Safe payload for Dashboard display
 */
export function redactForDashboard(
  payload: Record<string, unknown>,
  eventType: string,
  sourceApp?: string,
  privacyScope?: string
): Record<string, unknown> {
  const sensitivity = getSensitivity(eventType, sourceApp);
  const allowList = getAllowList(eventType, sourceApp);

  // Private scope + high sensitivity = stricter redaction
  const effectiveSensitivity: SensitivityLevel =
    privacyScope === "private" && sensitivity !== "high" ? "med" : sensitivity;

  return walkAndRedact(
    structuredClone(payload),
    allowList,
    effectiveSensitivity,
    new Set()
  ) as Record<string, unknown>;
}

/**
 * Quick check if a payload contains any obviously sensitive data
 */
export function hasSensitiveData(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  return keys.some((k) => ALWAYS_REDACT_KEYS.has(k));
}

/**
 * Create a summary of a payload (for list views)
 * Returns only key identifiers and counts
 */
export function summarizePayload(
  payload: Record<string, unknown>,
  eventType: string,
  sourceApp?: string
): Record<string, unknown> {
  const domain = sourceApp ?? eventType.split(".")[0];

  switch (domain) {
    case "browser":
      return {
        host: payload.host,
        title: payload.title,
        viewDurationMs: payload.viewDurationMs,
      };

    case "finance":
      return {
        transactionId: payload.transactionId,
        amount: payload.amount,
        currency: payload.currency,
        merchant: payload.merchant ?? payload.merchantNormalized,
        category: payload.category,
      };

    case "calendar":
      return {
        eventId: payload.eventId,
        title: payload.title,
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: payload.status,
      };

    case "tasks":
      return {
        taskId: payload.taskId,
        title: payload.title,
        status: payload.status,
        dueDate: payload.dueDate ?? payload.dueDateTime,
        priority: payload.priority,
      };

    case "email":
      return {
        messageId: payload.messageId,
        threadId: payload.threadId,
        subjectHash: payload.subjectHash,
        fromDomain: payload.fromDomain,
        recipientCount: payload.recipientCount,
        hasAttachments: payload.hasAttachments,
      };

    default:
      // Generic summary - just return first few safe keys
      const safe = redactForDashboard(payload, eventType, sourceApp);
      const keys = Object.keys(safe).slice(0, 5);
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        result[k] = safe[k];
      }
      return result;
  }
}
