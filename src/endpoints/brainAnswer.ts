/**
 * Brain Answer Endpoint (Window G)
 *
 * Forwards user answer requests to brain-platform.
 * Authenticated via Clerk JWT - userId is extracted from token.
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/brainAnswer" });

/**
 * Request body from client
 */
interface BrainAnswerBody {
  appId: string;
  query: string;
}

/**
 * Handle POST /v1/brain/answer
 *
 * Forwards answer requests to brain-platform.
 * The userId is provided from Clerk JWT verification.
 *
 * @param req - Incoming request
 * @param env - Environment bindings
 * @param userId - User ID from Clerk JWT
 */
export async function handleBrainAnswer(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    // Parse request body
    let body: BrainAnswerBody;
    try {
      body = (await req.json()) as BrainAnswerBody;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    if (!body.appId || !body.query) {
      return json({ ok: false, error: "missing appId/query" }, 400);
    }

    // Check brain answer URL is configured
    if (!env.BRAIN_ANSWER_URL) {
      return json({ ok: false, error: "BRAIN_ANSWER_URL not configured" }, 500);
    }

    // Forward to brain-platform with service auth
    const brainResp = await fetch(env.BRAIN_ANSWER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      },
      body: JSON.stringify({
        userId,
        appId: body.appId,
        query: body.query,
      }),
    });

    if (!brainResp.ok) {
      const errText = await brainResp.text().catch(() => "");
      return json(
        {
          ok: false,
          error: `brain error: ${brainResp.status}`,
          details: errText,
        },
        502
      );
    }

    const result = (await brainResp.json()) as Record<string, unknown>;
    return json({ ok: true, ...result });
  } catch (error) {
    logger.error("Brain answer endpoint error", error instanceof Error ? error : null, { userId });
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
