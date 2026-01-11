/**
 * PATCH: convex-ingestion-store/backend/convex/http.ts
 *
 * Changes:
 * 1. Add gateway key validation helper
 * 2. Rename /edge/calendar/* to /internal/calendar/*
 * 3. Deprecate direct /ingest/* access
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
// CHANGE: /edge/calendar/proposals/list → /internal/calendar/proposals/list
// ============================================================================

// BEFORE:
// http.route({
//   path: "/edge/calendar/proposals/list",
//   method: "GET",
//   handler: httpAction(async (ctx, request) => {
//     const identity = await ctx.auth.getUserIdentity();
//     if (!identity) return new Response("Unauthorized", { status: 401 });
//     // ... rest
//   }),
// });

// AFTER:
http.route({
  path: "/internal/calendar/proposals/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "20");

    const proposals = await ctx.runQuery(internal.calendar.listProposals, {
      userId: auth.userId,
      limit,
    });

    return new Response(JSON.stringify({ ok: true, proposals }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/calendar/proposals/ack → /internal/calendar/proposals/ack
// ============================================================================

http.route({
  path: "/internal/calendar/proposals/ack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const { proposalId, decision } = await request.json();

    await ctx.runMutation(internal.calendar.ackProposal, {
      userId: auth.userId,
      proposalId,
      decision,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/calendar/settings → /internal/calendar/settings
// ============================================================================

http.route({
  path: "/internal/calendar/settings",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const settings = await ctx.runQuery(internal.calendar.getSettings, {
      userId: auth.userId,
    });

    return new Response(JSON.stringify({ ok: true, settings }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// CHANGE: /edge/calendar/locks → /internal/calendar/locks
// ============================================================================

http.route({
  path: "/internal/calendar/locks",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const locks = await ctx.runQuery(internal.calendar.getLocks, {
      userId: auth.userId,
    });

    return new Response(JSON.stringify({ ok: true, locks }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// ADD: Internal ingest endpoint (for gateway fanout)
// ============================================================================

http.route({
  path: "/internal/ingest/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireGatewayKey(request);
    if (!auth.ok) return auth.response;

    const event = await request.json();

    // Validate userId matches header
    if (event.userId !== auth.userId) {
      return new Response(JSON.stringify({ ok: false, error: "user_mismatch" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ctx.runMutation(internal.events.insertEvent, event);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============================================================================
// DEPRECATE: /ingest/event (add deprecation headers, keep working)
// ============================================================================

// Keep existing handler but add deprecation warning
// This allows gradual migration - remove after all clients use gateway
http.route({
  path: "/ingest/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    console.warn("[DEPRECATED] Direct /ingest/event call - migrate to Edge Gateway");

    // ... existing handler logic ...

    // Add deprecation header to response
    const response = await existingIngestHandler(ctx, request);
    const headers = new Headers(response.headers);
    headers.set("X-Deprecated", "true");
    headers.set("X-Deprecation-Notice", "Use gateway.orion.workers.dev/v1/events/ingest");
    headers.set("Sunset", "2025-03-01"); // Set appropriate sunset date

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }),
});
