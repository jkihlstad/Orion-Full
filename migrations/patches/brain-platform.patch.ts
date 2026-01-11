/**
 * PATCH: brain-platform/convex/http.ts
 *
 * Changes:
 * 1. REMOVE duplicate /edge/social/* endpoints (now served by social-backend via gateway)
 * 2. ADD /internal/brain/query endpoint for gateway
 * 3. KEEP all /brain/* processing endpoints unchanged
 */

// ============================================================================
// REMOVE: Duplicate /edge/social/* endpoints
// These are duplicated from social-backend and should be removed.
// The Edge Gateway now proxies directly to social-backend.
// ============================================================================

// DELETE THIS ROUTE:
// http.route({
//   path: "/edge/social/invites/list",
//   method: "GET",
//   handler: ...
// });

// DELETE THIS ROUTE:
// http.route({
//   path: "/edge/social/invites/respond",
//   method: "POST",
//   handler: ...
// });

// DELETE THIS ROUTE:
// http.route({
//   path: "/edge/social/proposals/list",
//   method: "GET",
//   handler: ...
// });

// DELETE THIS ROUTE:
// http.route({
//   path: "/edge/social/settings",
//   method: "POST",
//   handler: ...
// });

// ============================================================================
// ADD: Gateway key validation helper
// ============================================================================

function requireGatewayKey(request: Request): { ok: true; userId: string } | { ok: false; response: Response } {
  const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
  if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const userId = request.headers.get("X-User-Id");
  if (!userId) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true, userId };
}

// ============================================================================
// ADD: /internal/brain/query - Query endpoint for Edge Gateway
// ============================================================================

http.route({
  path: "/internal/brain/query",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    // Request shape from gateway:
    // {
    //   userId: string,
    //   query: string,
    //   scopes: string[],
    //   timeRange: { since: number | null, until: number | null },
    //   granularity: "summary" | "detailed" | "raw",
    //   personalizationLevel: "low" | "medium" | "high",
    //   fallbackToWeb: boolean,
    // }

    // Validate userId matches header
    if (body.userId !== auth.userId) {
      return new Response(JSON.stringify({ ok: false, error: "user_mismatch" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await ctx.runAction(internal.brain.processQuery, {
        userId: body.userId,
        query: body.query,
        scopes: body.scopes ?? [],
        timeRange: body.timeRange ?? { since: null, until: null },
        granularity: body.granularity ?? "summary",
        personalizationLevel: body.personalizationLevel,
        fallbackToWeb: body.fallbackToWeb ?? false,
      });

      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: any) {
      console.error("Brain query error:", error);
      return new Response(JSON.stringify({
        ok: false,
        error: "query_failed",
        message: error?.message ?? String(error),
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// ============================================================================
// KEEP: All /brain/* processing endpoints (unchanged)
// These are used internally by the brain processing pipeline
// ============================================================================

// POST /brain/leaseSpeakerLabelEvents - Lease speaker label events for processing
// POST /brain/ackDone - Acknowledge successful processing completion
// POST /brain/ackFailed - Acknowledge processing failure
// POST /brain/createLabelSpeakerPrompt - Create speaker label prompts
// POST /brain/listPendingEvents - List pending events for processing
// POST /brain/scheduler/context - Get scheduler context
// POST /brain/scheduler/writeProposals - Write scheduling proposals
// POST /brain/social/context - Get availability context (X-Admin-Key)
// POST /brain/social/writeMeetingProposal - Create meeting proposals (X-Admin-Key)
