import { Env } from "../env";
import { json } from "../utils/respond";

/**
 * Proxy calendar endpoints to convex-ingestion-store
 * Gateway verifies auth, then forwards to internal calendar API
 */

async function proxyToCalendar(
  env: Env,
  userId: string,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  if (!env.CALENDAR_API_URL) {
    return json({ ok: false, error: "calendar_backend_not_configured" }, 503);
  }

  // Construct internal URL
  const url = `${env.CALENDAR_API_URL}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      "X-User-Id": userId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json().catch(() => ({ error: "invalid_response" }));
  return json(data, resp.status);
}

// GET /v1/calendar/proposals
export async function handleCalendarProposalsList(req: Request, env: Env, userId: string) {
  const url = new URL(req.url);
  const params = url.searchParams.toString();
  const path = `/proposals/list${params ? `?${params}` : ""}`;
  return proxyToCalendar(env, userId, path, "GET");
}

// POST /v1/calendar/proposals/ack
export async function handleCalendarProposalsAck(req: Request, env: Env, userId: string) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  return proxyToCalendar(env, userId, "/proposals/ack", "POST", body);
}

// GET /v1/calendar/settings
export async function handleCalendarSettingsGet(req: Request, env: Env, userId: string) {
  return proxyToCalendar(env, userId, "/settings", "GET");
}

// GET /v1/calendar/locks
export async function handleCalendarLocksGet(req: Request, env: Env, userId: string) {
  return proxyToCalendar(env, userId, "/locks", "GET");
}
