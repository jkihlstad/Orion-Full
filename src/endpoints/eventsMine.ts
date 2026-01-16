import { Env } from "../env";
import { json } from "../utils/respond";
import { d1ListEventsForUser } from "../storage/d1";
import { getRedactKeys } from "../registry/loader";
import { redactPayload } from "../utils/redact";
import { createLogger } from "../utils/logger";
import { EventRow } from "../types/database";

const logger = createLogger({ module: "endpoints/eventsMine" });

export async function handleEventsMine(req: Request, env: Env, clerkUserId: string): Promise<Response> {
  try {
    const url = new URL(req.url);
    const since = url.searchParams.get("since");
    const eventType = url.searchParams.get("eventType");
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));

    const sinceMs = since ? Number(since) : null;
    const rows = await d1ListEventsForUser(
      env,
      clerkUserId,
      Number.isFinite(sinceMs ?? NaN) ? sinceMs : null,
      limit
    ) as unknown as EventRow[];

    // Filter by eventType if specified
    let filtered = rows;
    if (eventType) {
      filtered = rows.filter((r) => r.event_type === eventType);
    }

    // Re-redact at read-time (belt & suspenders)
    const safe = filtered.map((r) => {
      const redactKeys = getRedactKeys(r.event_type);
      let payload: Record<string, unknown> = {};
      try {
        payload = r.payload_json ? JSON.parse(r.payload_json) : {};
      } catch {
        payload = { _parseError: true };
      }
      const redacted = redactPayload(payload, redactKeys);
      return {
        eventId: r.id,
        userId: r.user_id,
        sourceApp: r.source_app,
        eventType: r.event_type,
        timestamp: r.timestamp_ms,
        privacyScope: r.privacy_scope,
        payload: redacted,
      };
    });

    return json({ ok: true, items: safe }, 200);
  } catch (error) {
    logger.error("Events mine endpoint error", error instanceof Error ? error : null, { userId: clerkUserId });
    return new Response(JSON.stringify({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
