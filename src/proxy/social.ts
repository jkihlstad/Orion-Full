import { Env } from "../env";
import { json } from "../utils/respond";

/**
 * Proxy social endpoints to social-backend
 * Gateway verifies auth, then forwards to internal social API
 */

async function proxyToSocial(
  env: Env,
  userId: string,
  path: string,
  method: string,
  body?: any
): Promise<Response> {
  if (!env.SOCIAL_SIGNAL_URL) {
    return json({ ok: false, error: "social_backend_not_configured" }, 503);
  }

  // Construct internal URL (replace /v1/social with /internal/social)
  const baseUrl = env.SOCIAL_SIGNAL_URL.replace(/\/[^/]+$/, ""); // remove trailing path
  const internalPath = path.replace("/v1/social", "/internal/social");
  const url = `${baseUrl}${internalPath}`;

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

// GET /v1/social/invites
export async function handleSocialInvitesList(req: Request, env: Env, userId: string) {
  const url = new URL(req.url);
  const params = url.searchParams.toString();
  const path = `/v1/social/invites${params ? `?${params}` : ""}`;
  return proxyToSocial(env, userId, path, "GET");
}

// POST /v1/social/invites/respond
export async function handleSocialInvitesRespond(req: Request, env: Env, userId: string) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  return proxyToSocial(env, userId, "/v1/social/invites/respond", "POST", body);
}

// GET /v1/social/settings
export async function handleSocialSettingsGet(req: Request, env: Env, userId: string) {
  return proxyToSocial(env, userId, "/v1/social/settings", "GET");
}

// POST /v1/social/settings
export async function handleSocialSettingsSet(req: Request, env: Env, userId: string) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  return proxyToSocial(env, userId, "/v1/social/settings", "POST", body);
}

// GET /v1/social/edges
export async function handleSocialEdgesList(req: Request, env: Env, userId: string) {
  const url = new URL(req.url);
  const params = url.searchParams.toString();
  const path = `/v1/social/edges${params ? `?${params}` : ""}`;
  return proxyToSocial(env, userId, path, "GET");
}

// POST /v1/social/edges
export async function handleSocialEdgesCreate(req: Request, env: Env, userId: string) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  return proxyToSocial(env, userId, "/v1/social/edges", "POST", body);
}

// DELETE /v1/social/edges
export async function handleSocialEdgesRemove(req: Request, env: Env, userId: string) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  return proxyToSocial(env, userId, "/v1/social/edges", "DELETE", body);
}
