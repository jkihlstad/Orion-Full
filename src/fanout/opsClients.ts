import { OpsProxyResponse } from "../types/queue";

export type OpsEnv = {
  ADMIN_API_KEY?: string;
  CONVEX_OPS_BASE_URL?: string;
  CONVEX_OPS_KEY?: string;
  BRAIN_OPS_BASE_URL?: string;
  BRAIN_OPS_KEY?: string;
  NEO4J_OPS_BASE_URL?: string;
  NEO4J_OPS_KEY?: string;
};

function must(v: string | undefined, name: string): string {
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function proxyGet(url: string, keyHeader: string, keyValue: string): Promise<OpsProxyResponse> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      [keyHeader]: keyValue,
      "Accept": "application/json",
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* ignore parse errors */ }
  return { status: res.status, json, text };
}

export async function convexHasEvent(env: OpsEnv, eventId: string) {
  const base = must(env.CONVEX_OPS_BASE_URL, "CONVEX_OPS_BASE_URL");
  const key = must(env.CONVEX_OPS_KEY, "CONVEX_OPS_KEY");
  return proxyGet(`${base}/ops/hasEvent?eventId=${encodeURIComponent(eventId)}`, "X-Ops-Key", key);
}

export async function brainStatus(env: OpsEnv, eventId: string) {
  const base = must(env.BRAIN_OPS_BASE_URL, "BRAIN_OPS_BASE_URL");
  const key = must(env.BRAIN_OPS_KEY, "BRAIN_OPS_KEY");
  return proxyGet(`${base}/ops/status?eventId=${encodeURIComponent(eventId)}`, "X-Ops-Key", key);
}

export async function neo4jHasNode(env: OpsEnv, eventId: string) {
  const base = must(env.NEO4J_OPS_BASE_URL, "NEO4J_OPS_BASE_URL");
  const key = must(env.NEO4J_OPS_KEY, "NEO4J_OPS_KEY");
  return proxyGet(`${base}/ops/hasNode?eventId=${encodeURIComponent(eventId)}`, "X-Ops-Key", key);
}
