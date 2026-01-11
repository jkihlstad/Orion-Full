import { Env } from "../env";
import { hmacSha256Hex, hexToBytes, timingSafeEqual } from "../utils/crypto";

export async function verifyRequestSignature(req: Request, env: Env, rawBody: ArrayBuffer) {
  // Optional: if no secret set, skip signature verification
  if (!env.REQUEST_HMAC_SECRET) return { enabled: false, ok: true };

  const sent = req.headers.get("X-Req-Signature");
  if (!sent) return { enabled: true, ok: false, reason: "Missing X-Req-Signature" };

  const computedHex = await hmacSha256Hex(env.REQUEST_HMAC_SECRET, rawBody);

  let ok = false;
  try {
    ok = timingSafeEqual(hexToBytes(sent), hexToBytes(computedHex));
  } catch {
    return { enabled: true, ok: false, reason: "Bad signature format" };
  }

  return { enabled: true, ok, reason: ok ? undefined : "Invalid signature" };
}
