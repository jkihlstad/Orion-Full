/**
 * redactPreview.ts
 *
 * Builds safe, redacted preview of event payloads for admin/debug endpoints.
 * Never exposes raw PII - only safe summaries.
 */

function safeHost(urlStr?: string): string | null {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const u = new URL(urlStr);
    return u.host;
  } catch {
    return null;
  }
}

function safeLength(str?: unknown): number | null {
  if (typeof str === 'string') return str.length;
  return null;
}

function safeDomain(email?: string): string | null {
  if (!email || typeof email !== 'string') return null;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1] : null;
}

export interface PayloadPreview {
  [key: string]: unknown;
}

/**
 * Build a safe preview of an event payload based on its domain.
 * This is what gets returned in admin endpoints - never the raw payload.
 */
export function payloadPreview(eventType: string, payload: unknown): PayloadPreview {
  if (!payload || typeof payload !== 'object') {
    return { _empty: true };
  }

  const p = payload as Record<string, unknown>;
  const domain = eventType.split('.')[0];

  switch (domain) {
    case 'browser':
      return buildBrowserPreview(p);
    case 'finance':
      return buildFinancePreview(p);
    case 'email':
      return buildEmailPreview(p);
    case 'calendar':
      return buildCalendarPreview(p);
    case 'tasks':
      return buildTasksPreview(p);
    case 'system':
      return buildSystemPreview(p);
    case 'consent':
      return buildConsentPreview(p);
    case 'communication':
      return buildCommunicationPreview(p);
    default:
      return buildGenericPreview(p);
  }
}

function buildBrowserPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    urlHost: safeHost(p.url as string),
    titleLen: safeLength(p.title),
    refHost: safeHost(p.referrer as string),
    interactionType: p.interactionType ?? null,
    dwellTimeMs: typeof p.dwellTimeMs === 'number' ? p.dwellTimeMs : null,
    scrollDepth: typeof p.scrollDepth === 'number' ? p.scrollDepth : null,
  };
}

function buildFinancePreview(p: Record<string, unknown>): PayloadPreview {
  return {
    amount: typeof p.amount === 'number' ? p.amount : null,
    currency: typeof p.currency === 'string' ? p.currency : null,
    category: typeof p.category === 'string' ? p.category : null,
    merchantLen: safeLength(p.merchant),
    transactionType: p.transactionType ?? null,
    isRecurring: p.isRecurring ?? null,
  };
}

function buildEmailPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    fromDomain: safeDomain(p.from as string),
    toDomain: safeDomain(p.to as string),
    subjectLen: safeLength(p.subject),
    hasAttachments: Boolean(p.hasAttachments || p.attachmentCount),
    attachmentCount: typeof p.attachmentCount === 'number' ? p.attachmentCount : null,
    threadDepth: typeof p.threadDepth === 'number' ? p.threadDepth : null,
  };
}

function buildCalendarPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    titleLen: safeLength(p.title),
    startMs: typeof p.startMs === 'number' ? p.startMs : null,
    endMs: typeof p.endMs === 'number' ? p.endMs : null,
    durationMinutes: typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
    isAllDay: p.isAllDay ?? null,
    attendeeCount: typeof p.attendeeCount === 'number' ? p.attendeeCount : null,
    hasLocation: Boolean(p.location),
  };
}

function buildTasksPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    titleLen: safeLength(p.title),
    dueMs: typeof p.dueMs === 'number' ? p.dueMs : null,
    completed: p.completed ?? null,
    priority: p.priority ?? null,
    hasNotes: Boolean(p.notes),
    tagCount: Array.isArray(p.tags) ? p.tags.length : null,
  };
}

function buildSystemPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    action: p.action ?? null,
    status: p.status ?? null,
    permissionType: p.permissionType ?? null,
    errorCode: p.errorCode ?? null,
  };
}

function buildConsentPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    scope: p.scope ?? null,
    enabled: p.enabled ?? null,
    consentVersion: p.consentVersion ?? null,
    scopeCount: Array.isArray(p.scopes) ? p.scopes.length : null,
  };
}

function buildCommunicationPreview(p: Record<string, unknown>): PayloadPreview {
  return {
    messageType: p.messageType ?? null,
    direction: p.direction ?? null,
    durationSeconds: typeof p.durationSeconds === 'number' ? p.durationSeconds : null,
    participantCount: typeof p.participantCount === 'number' ? p.participantCount : null,
  };
}

function buildGenericPreview(p: Record<string, unknown>): PayloadPreview {
  // For unknown event types, just return the top-level keys (no values)
  const keys = Object.keys(p).slice(0, 15);
  return {
    _keys: keys,
    _keyCount: Object.keys(p).length,
  };
}
