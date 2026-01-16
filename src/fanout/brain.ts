import { z } from "zod";
import { Env } from "../env";
import { EventEnvelopeT, PrivacyScope } from "../types";
import { isBrainEnabled, isGraphRequired } from "../validation/registry";

// ============================================================================
// Brain Query API (Gateway -> Brain)
// ============================================================================

const BrainQueryBody = z.object({
  userId: z.string().min(1),
  query: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  timeRange: z.object({
    since: z.number().nullable().optional(),
    until: z.number().nullable().optional(),
  }).optional(),
  granularity: z.enum(["summary", "detailed"]).optional(),
  personalizationLevel: z.enum(["low", "medium", "high"]).optional(),
  fallbackToWeb: z.boolean().optional(),
}).passthrough();

export async function queryBrain(env: Env, body: unknown) {
  if (!env.BRAIN_QUERY_URL) throw new Error("Missing BRAIN_QUERY_URL");

  const parsed = BrainQueryBody.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid BrainQueryBody: ${parsed.error.message}`);
  }

  const resp = await fetch(env.BRAIN_QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
    },
    body: JSON.stringify(parsed.data),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Brain query failed: ${resp.status} ${t}`);
  }

  return await resp.json();
}

// ============================================================================
// Brain Ingest (Event Fanout)
// ============================================================================

const BrainIngestPayloadSchema = z.object({
  eventId: z.string().min(8),
  userId: z.string().min(1),
  eventType: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  payload: z.record(z.unknown()),
  sourceApp: z.string().min(1),
  privacyScope: PrivacyScope,
  graphRequired: z.boolean(),
  traceId: z.string().optional(),
}).passthrough();

export type BrainIngestPayload = z.infer<typeof BrainIngestPayloadSchema>;

export interface BrainIngestResult {
  forwarded: boolean;
  reason?: string;
}

export function shouldForwardToBrain(eventType: string): boolean {
  return isBrainEnabled(eventType);
}

export async function forwardToBrain(
  env: Env,
  envelope: EventEnvelopeT
): Promise<BrainIngestResult> {
  if (!shouldForwardToBrain(envelope.eventType)) {
    return { forwarded: false, reason: `brainEnabled=false for eventType: ${envelope.eventType}` };
  }

  if (!env.BRAIN_INGEST_URL) {
    return { forwarded: false, reason: "BRAIN_INGEST_URL not configured" };
  }

  // Prefer traceId already attached to the envelope (from ingest -> queue)
  const traceId = (envelope as Record<string, unknown>).traceId as string | undefined;

  const brainPayload: BrainIngestPayload = {
    eventId: envelope.eventId,
    userId: envelope.userId,
    eventType: envelope.eventType,
    timestamp: envelope.timestamp,
    payload: envelope.payload,
    sourceApp: envelope.sourceApp,
    privacyScope: envelope.privacyScope,
    graphRequired: isGraphRequired(envelope.eventType),
    ...(traceId ? { traceId } : {}),
  };

  // Validate (prevents drift)
  const checked = BrainIngestPayloadSchema.parse(brainPayload);

  const resp = await fetch(env.BRAIN_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      ...(traceId ? { "X-Trace-Id": traceId } : {}),
    },
    body: JSON.stringify(checked),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Brain ingest failed: ${resp.status} ${errorText}`);
  }

  return { forwarded: true };
}

export async function forwardToBrainBatch(
  env: Env,
  envelopes: EventEnvelopeT[]
): Promise<Map<string, BrainIngestResult>> {
  const results = new Map<string, BrainIngestResult>();

  const toForward: EventEnvelopeT[] = [];
  for (const envelope of envelopes) {
    if (shouldForwardToBrain(envelope.eventType)) toForward.push(envelope);
    else results.set(envelope.eventId, {
      forwarded: false,
      reason: `brainEnabled=false for eventType: ${envelope.eventType}`,
    });
  }

  if (toForward.length === 0) return results;

  if (!env.BRAIN_INGEST_URL) {
    for (const envelope of toForward) {
      results.set(envelope.eventId, { forwarded: false, reason: "BRAIN_INGEST_URL not configured" });
    }
    return results;
  }

  // Optional: If batch has mixed traceIds, don't set X-Trace-Id header (ambiguous)
  const traceIds = new Set<string>();
  for (const e of toForward) {
    const t = (e as Record<string, unknown>).traceId as string | undefined;
    if (t) traceIds.add(t);
  }
  const singleTraceId = traceIds.size === 1 ? [...traceIds][0] : undefined;

  const batchEvents = toForward.map((envelope) => {
    const traceId = (envelope as Record<string, unknown>).traceId as string | undefined;
    const payload: BrainIngestPayload = {
      eventId: envelope.eventId,
      userId: envelope.userId,
      eventType: envelope.eventType,
      timestamp: envelope.timestamp,
      payload: envelope.payload,
      sourceApp: envelope.sourceApp,
      privacyScope: envelope.privacyScope,
      graphRequired: isGraphRequired(envelope.eventType),
      ...(traceId ? { traceId } : {}),
    };
    return BrainIngestPayloadSchema.parse(payload);
  });

  const resp = await fetch(`${env.BRAIN_INGEST_URL}/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      ...(singleTraceId ? { "X-Trace-Id": singleTraceId } : {}),
    },
    body: JSON.stringify({ events: batchEvents }),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Brain batch ingest failed: ${resp.status} ${errorText}`);
  }

  for (const envelope of toForward) results.set(envelope.eventId, { forwarded: true });
  return results;
}
