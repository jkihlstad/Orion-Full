/**
 * PATCH: social-backend/convex/http.ts
 *
 * Changes:
 * 1. Add gateway key validation helper
 * 2. Rename /edge/social/* to /internal/social/*
 * 3. Add /internal/social/signal for gateway fanout
 * 4. Keep /brain/social/* endpoints unchanged
 */

// ============================================================================
// ADD: Gateway key validation helper (at top of file)
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
// CHANGE: /edge/social/invites/list → /internal/social/invites/list
// ============================================================================

http.route({
  path: "/internal/social/invites/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "20");

    const invites = await ctx.runQuery(internal.social.listInvites, {
      userId: auth.userId,
      status,
      limit,
    });

    return new Response(JSON.stringify({ ok: true, invites }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/invites/respond → /internal/social/invites/respond
// ============================================================================

http.route({
  path: "/internal/social/invites/respond",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const { inviteId, decision, selectedSlot } = await request.json();

    await ctx.runMutation(internal.social.respondToInvite, {
      userId: auth.userId,
      inviteId,
      decision,
      selectedSlot,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/settings GET → /internal/social/settings GET
// ============================================================================

http.route({
  path: "/internal/social/settings",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const settings = await ctx.runQuery(internal.social.getSettings, {
      userId: auth.userId,
    });

    return new Response(JSON.stringify({ ok: true, settings }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/settings POST → /internal/social/settings POST
// ============================================================================

http.route({
  path: "/internal/social/settings",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const updates = await request.json();

    await ctx.runMutation(internal.social.updateSettings, {
      userId: auth.userId,
      ...updates,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/edges GET → /internal/social/edges GET
// ============================================================================

http.route({
  path: "/internal/social/edges",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50");

    const edges = await ctx.runQuery(internal.social.listEdges, {
      userId: auth.userId,
      kind,
      limit,
    });

    return new Response(JSON.stringify({ ok: true, edges }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/edges POST → /internal/social/edges POST
// ============================================================================

http.route({
  path: "/internal/social/edges",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const { targetUserId, kind } = await request.json();

    const edge = await ctx.runMutation(internal.social.createEdge, {
      userId: auth.userId,
      targetUserId,
      kind,
    });

    return new Response(JSON.stringify({ ok: true, edge }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/social/edges DELETE → /internal/social/edges DELETE
// ============================================================================

http.route({
  path: "/internal/social/edges",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const { edgeId } = await request.json();

    await ctx.runMutation(internal.social.removeEdge, {
      userId: auth.userId,
      edgeId,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// ADD: /internal/social/signal - Receive reduced signals from gateway
// ============================================================================

http.route({
  path: "/internal/social/signal",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const signal = await request.json();
    // Signal shape from gateway:
    // {
    //   userId: string,
    //   eventType: string,
    //   reducedPayload: { ... },  // Only non-sensitive fields
    //   timestamp: number,
    //   eventId: string,
    // }

    // Validate userId matches header
    if (signal.userId !== auth.userId) {
      return new Response(JSON.stringify({ ok: false, error: "user_mismatch" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ctx.runMutation(internal.signals.ingestSignal, {
      userId: signal.userId,
      eventType: signal.eventType,
      reducedPayload: signal.reducedPayload,
      timestamp: signal.timestamp,
      eventId: signal.eventId,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// KEEP: /brain/social/* endpoints (brain-to-social communication)
// These remain unchanged - they use X-Admin-Key authentication
// ============================================================================

// POST /brain/social/context - Get availability context
// POST /brain/social/writeMeetingProposal - Create meeting proposals
