import { z } from "zod";
import { Env } from "../env";
import { json } from "../utils/respond";
import { d1ListConsents, d1SetConsent } from "../storage/d1";

// GET /v1/consent/get
export async function handleConsentGet(_req: Request, env: Env, clerkUserId: string) {
  const items = await d1ListConsents(env, clerkUserId);
  return json({ ok: true, items }, 200);
}

const ConsentSetBody = z.object({
  scope: z.string().min(1),
  enabled: z.boolean(),
});

// POST /v1/consent/set
export async function handleConsentSet(req: Request, env: Env, clerkUserId: string) {
  const raw = await req.json().catch(() => null);
  if (!raw) return json({ ok: false, error: "invalid_json" }, 400);

  const parsed = ConsentSetBody.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_request", details: parsed.error.issues }, 400);
  }

  await d1SetConsent(env, clerkUserId, parsed.data.scope, parsed.data.enabled);
  return json({ ok: true }, 200);
}
