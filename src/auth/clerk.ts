import { must, Env } from "../env";
import { json } from "../utils/respond";
import { ParsedJwt, JwtHeader, JwtPayload } from "../types/queue";

type Jwk = { kty: string; kid: string; use?: string; n?: string; e?: string; alg?: string };
type Jwks = { keys: Jwk[] };

let cachedJwks: { at: number; jwks: Jwks } | null = null;

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getJwks(env: Env): Promise<Jwks> {
  const now = Date.now();
  if (cachedJwks && now - cachedJwks.at < 5 * 60_000) return cachedJwks.jwks;

  const url = must(env.CLERK_JWKS_URL, "Missing CLERK_JWKS_URL");
  // Cloudflare-specific cache options - using type assertion for CF-specific RequestInit
  const resp = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const jwks = (await resp.json()) as Jwks;
  cachedJwks = { at: now, jwks };
  return jwks;
}

function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Bad JWT");
  const [h, p, s] = parts;

  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(h))) as JwtHeader;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(p))) as JwtPayload;
  const signature = base64UrlToUint8Array(s);

  return { header, payload, signingInput: `${h}.${p}`, signature };
}

async function importRsaKey(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

export async function verifyClerkJWT(req: Request, env: Env): Promise<string> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("Missing Authorization Bearer token");

  const { header, payload, signingInput, signature } = parseJwt(token);

  const jwks = await getJwks(env);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown kid");

  const key = await importRsaKey(jwk);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput)
  );
  if (!ok) throw new Error("Invalid JWT signature");

  // Basic claims checks
  const iss = must(env.CLERK_ISSUER, "Missing CLERK_ISSUER");
  if (payload.iss && payload.iss !== iss) throw new Error("Bad issuer");

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && nowSec >= payload.exp) throw new Error("JWT expired");

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") throw new Error("Missing sub");

  return sub;
}

export function authError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  return json({ ok: false, error: message }, 401);
}
