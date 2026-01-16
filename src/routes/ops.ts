import { OpsEnv, convexHasEvent, brainStatus, neo4jHasNode } from "../fanout/opsClients";

function json(resBody: unknown, status = 200): Response {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireAdmin(req: Request, env: OpsEnv) {
  const key = req.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_API_KEY || key !== env.ADMIN_API_KEY) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  return null;
}

export async function handleOpsConvexHasEvent(req: Request, env: OpsEnv) {
  const denied = requireAdmin(req, env);
  if (denied) return denied;

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return json({ ok: false, error: "missing eventId" }, 400);

  try {
    const r = await convexHasEvent(env, eventId);
    return json({ ok: true, upstreamStatus: r.status, data: r.json ?? r.text }, r.status < 300 ? 200 : r.status);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}

export async function handleOpsBrainStatus(req: Request, env: OpsEnv) {
  const denied = requireAdmin(req, env);
  if (denied) return denied;

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return json({ ok: false, error: "missing eventId" }, 400);

  try {
    const r = await brainStatus(env, eventId);
    return json({ ok: true, upstreamStatus: r.status, data: r.json ?? r.text }, r.status < 300 ? 200 : r.status);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}

export async function handleOpsNeo4jHasNode(req: Request, env: OpsEnv) {
  const denied = requireAdmin(req, env);
  if (denied) return denied;

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return json({ ok: false, error: "missing eventId" }, 400);

  try {
    const r = await neo4jHasNode(env, eventId);
    return json({ ok: true, upstreamStatus: r.status, data: r.json ?? r.text }, r.status < 300 ? 200 : r.status);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}
