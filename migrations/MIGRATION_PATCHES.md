# Edge Gateway Migration Patches

This document describes the changes required in other repositories to complete
the migration to the centralized Edge Gateway.

## Overview

The Edge Gateway (`edge-gateway-worker`) now consolidates all client-facing
gateway functionality. Backend services should:
1. Keep their internal endpoints (for gateway-to-backend communication)
2. Remove/deprecate their external `/edge/*` endpoints
3. Accept requests from the gateway using `X-Gateway-Internal-Key`

---

## 1. convex-ingestion-store

**File:** `backend/convex/http.ts`

### Changes Required

#### A. Deprecate external `/ingest/*` endpoints

The Edge Gateway now handles all client ingestion via `/v1/events/ingest`.
Clients should no longer call `/ingest/event` or `/ingest/batch` directly.

**Option 1 - Soft deprecation (recommended for transition):**
```typescript
// Add deprecation header to responses
http.route({
  path: "/ingest/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    console.warn("DEPRECATED: /ingest/event called directly. Use Edge Gateway /v1/events/ingest");
    // ... existing logic
    const response = /* existing response */;
    return new Response(response.body, {
      ...response,
      headers: {
        ...response.headers,
        "X-Deprecated": "true",
        "X-Deprecation-Notice": "Use gateway.orion.workers.dev/v1/events/ingest",
      },
    });
  }),
});
```

**Option 2 - Hard cutover (after clients migrated):**
```typescript
// Reject external calls, only allow gateway
http.route({
  path: "/ingest/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
    if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
      return new Response(JSON.stringify({
        ok: false,
        error: "direct_access_disabled",
        message: "Use Edge Gateway for event ingestion",
      }), { status: 403 });
    }
    // ... existing logic for gateway calls
  }),
});
```

#### B. Internalize `/edge/calendar/*` endpoints

These endpoints are now proxied through Edge Gateway's `/v1/calendar/*`.
Keep them but restrict to gateway-only access:

```typescript
// Before
http.route({ path: "/edge/calendar/proposals/list", ... });

// After - rename to /internal/ and require gateway key
http.route({
  path: "/internal/calendar/proposals/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
    if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
      return new Response("Forbidden", { status: 403 });
    }
    // Extract userId from X-User-Id header (set by gateway)
    const userId = request.headers.get("X-User-Id");
    if (!userId) {
      return new Response("Missing X-User-Id", { status: 400 });
    }
    // ... existing logic
  }),
});
```

---

## 2. social-backend

**File:** `convex/http.ts`, `convex/http/social.ts`

### Changes Required

#### A. Internalize `/edge/social/*` endpoints

Rename from `/edge/social/*` to `/internal/social/*` and require gateway key:

```typescript
// Before
http.route({ path: "/edge/social/invites/list", ... });

// After
http.route({
  path: "/internal/social/invites/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
    if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
      return new Response("Forbidden", { status: 403 });
    }
    const userId = request.headers.get("X-User-Id");
    // ... rest of handler
  }),
});
```

**Endpoints to internalize:**
- `/edge/social/invites/list` → `/internal/social/invites/list`
- `/edge/social/invites/respond` → `/internal/social/invites/respond`
- `/edge/social/settings` (GET/POST) → `/internal/social/settings`
- `/edge/social/edges` (GET/POST/DELETE) → `/internal/social/edges`

#### B. Keep `/brain/social/*` endpoints

These are used for brain-to-social communication and should remain:
- `POST /brain/social/context` (X-Admin-Key auth)
- `POST /brain/social/writeMeetingProposal` (X-Admin-Key auth)

#### C. Add signal ingestion endpoint

Add an internal endpoint for receiving social signals from the gateway:

```typescript
http.route({
  path: "/internal/social/signal",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
    if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const signal = await request.json();
    // signal shape: { userId, eventType, reducedPayload, timestamp }

    await ctx.runMutation(internal.signals.ingestSignal, signal);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }),
});
```

---

## 3. brain-platform

**File:** `convex/http.ts`

### Changes Required

#### A. Remove duplicate `/edge/social/*` endpoints

These endpoints are duplicated from social-backend and should be removed.
The Edge Gateway now proxies directly to social-backend.

**Remove these routes:**
- `GET /edge/social/invites/list`
- `POST /edge/social/invites/respond`
- `GET /edge/social/proposals/list`
- `POST /edge/social/settings`

#### B. Keep `/brain/*` endpoints

These are internal processing endpoints and should remain:
- `POST /brain/leaseSpeakerLabelEvents`
- `POST /brain/ackDone`
- `POST /brain/ackFailed`
- `POST /brain/createLabelSpeakerPrompt`
- `POST /brain/listPendingEvents`
- `POST /brain/scheduler/context`
- `POST /brain/scheduler/writeProposals`
- `POST /brain/social/context`
- `POST /brain/social/writeMeetingProposal`

#### C. Add query endpoint for Edge Gateway

Add internal endpoint for the gateway's `/v1/brain/query`:

```typescript
http.route({
  path: "/internal/brain/query",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const gatewayKey = request.headers.get("X-Gateway-Internal-Key");
    if (gatewayKey !== process.env.GATEWAY_INTERNAL_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const { userId, query, scopes, timeRange, granularity, personalizationLevel, fallbackToWeb }
      = await request.json();

    const result = await ctx.runAction(internal.brain.processQuery, {
      userId,
      query,
      scopes,
      timeRange,
      granularity,
      personalizationLevel,
      fallbackToWeb,
    });

    return new Response(JSON.stringify(result), { status: 200 });
  }),
});
```

---

## 4. ios-finance/ai-mgmt-worker

**Status:** DEPRECATED - Delete entire directory

The `ai-mgmt-worker` functionality has been consolidated into `edge-gateway-worker`.

### Migration Steps

1. **Stop deployment** of `ai-mgmt-worker` to Cloudflare
2. **Update iOS finance app** to use Edge Gateway:
   - `/v1/events/ingest` → `gateway.orion.workers.dev/v1/events/ingest`
   - `/v1/brain/query` → `gateway.orion.workers.dev/v1/brain/query`
3. **Delete the directory** after confirming no traffic

```bash
# After confirming no traffic to ai-mgmt-worker
rm -rf repos/ios-finance/ai-mgmt-worker
```

---

## Environment Variables

Each backend needs these new environment variables:

| Variable | Description |
|----------|-------------|
| `GATEWAY_INTERNAL_KEY` | Shared secret for gateway-to-backend auth |

The Edge Gateway needs:

| Variable | Description |
|----------|-------------|
| `CONVEX_INGEST_URL` | https://convex-ingestion-store.convex.site/internal/ingest |
| `BRAIN_QUERY_URL` | https://brain-platform.convex.site/internal/brain/query |
| `SOCIAL_SIGNAL_URL` | https://social-backend.convex.site/internal/social/signal |
| `SOCIAL_PROXY_URL` | https://social-backend.convex.site/internal/social |
| `CALENDAR_API_URL` | https://convex-ingestion-store.convex.site/internal/calendar |

---

## Cutover Sequence

1. **Phase A - Deploy gateway** (no traffic yet)
   - Deploy `edge-gateway-worker` to Cloudflare
   - Verify health endpoint works

2. **Phase B - Deploy backend patches**
   - Deploy convex-ingestion-store with `/internal/*` endpoints
   - Deploy social-backend with `/internal/*` endpoints
   - Deploy brain-platform with `/internal/brain/query` and removed duplicates
   - Keep old endpoints active during transition

3. **Phase C - Migrate clients**
   - Update iOS apps to use gateway endpoints
   - Update dashboard to use gateway endpoints
   - Monitor both old and new endpoints

4. **Phase D - Remove old endpoints**
   - After 7 days with no traffic on old endpoints
   - Remove deprecated `/edge/*` routes from backends
   - Delete `ai-mgmt-worker`

---

## Verification Checklist

- [ ] Gateway health check returns 200
- [ ] Gateway can verify Clerk JWTs
- [ ] Gateway can reach Convex ingest endpoint
- [ ] Gateway can reach Brain query endpoint
- [ ] Gateway can reach Social signal endpoint
- [ ] Gateway can proxy Social invites/settings/edges
- [ ] Gateway can proxy Calendar proposals/settings/locks
- [ ] R2 blob uploads work
- [ ] D1 idempotency deduplicates correctly
- [ ] KV rate limiting enforced
- [ ] Queue fanout delivers to all backends
