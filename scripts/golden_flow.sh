#!/bin/bash
# Golden Flow Test for Edge Gateway
# Tests the complete event pipeline: Ingest -> D1 -> Queue -> Fanout (Convex, Brain, Social)
#
# Usage: ./scripts/golden_flow.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (optional)
#   TRACE_ID      - Custom trace ID (default: auto-generated)

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"
TRACE_ID="${TRACE_ID:-golden_$(date +%s)_$$}"

echo "=============================================="
echo "  Golden Flow Test - Edge Gateway Pipeline"
echo "=============================================="
echo "Gateway:  $GATEWAY_URL"
echo "Trace ID: $TRACE_ID"
echo ""

# Validate required env vars
if [ -z "$TEST_JWT" ]; then
  echo "ERROR: TEST_JWT environment variable is required"
  exit 1
fi

if [ -z "$TEST_USER_ID" ]; then
  echo "ERROR: TEST_USER_ID environment variable is required"
  exit 1
fi

PASS=0
FAIL=0
EVENT_IDS=()

# Helper function
check_result() {
  local name="$1"
  local condition="$2"
  local details="$3"

  printf "%-40s " "$name..."
  if [ "$condition" = "true" ]; then
    echo "PASS"
    [ -n "$details" ] && echo "    $details"
    ((PASS++))
    return 0
  else
    echo "FAIL"
    [ -n "$details" ] && echo "    $details"
    ((FAIL++))
    return 1
  fi
}

echo "=== Phase 1: Health Check ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
check_result "Gateway health" "$([ "$STATUS" = "200" ] && echo true || echo false)" "HTTP $STATUS"

echo ""
echo "=== Phase 2: Consent Setup ==="

# Enable consent for the scopes we'll use
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "2026-01-11",
    "updates": {
      "system.telemetry_basic": true
    }
  }')
OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Enable consent scopes" "$OK" ""

echo ""
echo "=== Phase 3: Event Ingest (Single) ==="

EVENT_ID_1="golden_single_$(date +%s)_$$"
IDEM_KEY_1="golden_idem_single_$(date +%s)_$$"
TIMESTAMP=$(($(date +%s) * 1000))

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID" \
  -d '{
    "eventId": "'"$EVENT_ID_1"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "dashboard",
    "eventType": "system.smoke_test",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_1"'",
    "payload": {
      "test": "golden_flow",
      "phase": "single_ingest",
      "traceId": "'"$TRACE_ID"'"
    }
  }')

OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "Single event ingest" "$OK" "eventId: $RETURNED_ID"
EVENT_IDS+=("$EVENT_ID_1")

# Test idempotency - same request should return deduped=true
echo ""
echo "=== Phase 4: Idempotency Check ==="

IDEM_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID" \
  -d '{
    "eventId": "'"$EVENT_ID_1"'_dup",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "dashboard",
    "eventType": "system.smoke_test",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_1"'",
    "payload": { "test": "idempotency_check" }
  }')

OK=$(echo "$IDEM_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
DEDUPED=$(echo "$IDEM_RESP" | jq -r '.deduped' 2>/dev/null || echo "false")
check_result "Idempotency (deduped)" "$([ "$OK" = "true" ] && [ "$DEDUPED" = "true" ] && echo true || echo false)" "deduped: $DEDUPED"

echo ""
echo "=== Phase 5: Batch Ingest ==="

EVENT_ID_2="golden_batch1_$(date +%s)_$$"
EVENT_ID_3="golden_batch2_$(date +%s)_$$"
IDEM_KEY_2="golden_idem_batch1_$(date +%s)_$$"
IDEM_KEY_3="golden_idem_batch2_$(date +%s)_$$"
TIMESTAMP2=$(($(date +%s) * 1000 + 1000))
TIMESTAMP3=$(($(date +%s) * 1000 + 2000))

BATCH_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingestBatch" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID" \
  -d '{
    "events": [
      {
        "eventId": "'"$EVENT_ID_2"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "dashboard",
        "eventType": "system.smoke_test",
        "timestamp": '"$TIMESTAMP2"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "'"$IDEM_KEY_2"'",
        "payload": { "test": "golden_flow", "phase": "batch_1" }
      },
      {
        "eventId": "'"$EVENT_ID_3"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "dashboard",
        "eventType": "system.smoke_test",
        "timestamp": '"$TIMESTAMP3"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "'"$IDEM_KEY_3"'",
        "payload": { "test": "golden_flow", "phase": "batch_2" }
      }
    ]
  }')

OK=$(echo "$BATCH_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
ACCEPTED=$(echo "$BATCH_RESP" | jq -r '.accepted' 2>/dev/null || echo "0")
check_result "Batch ingest (2 events)" "$([ "$OK" = "true" ] && [ "$ACCEPTED" = "2" ] && echo true || echo false)" "accepted: $ACCEPTED"
EVENT_IDS+=("$EVENT_ID_2" "$EVENT_ID_3")

echo ""
echo "=== Phase 6: Verify Events in D1 ==="

# Check events/mine to verify events were stored
MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=10" \
  -H "Authorization: Bearer $TEST_JWT")

OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Events stored in D1" "$OK" "found $COUNT events"

echo ""
echo "=== Phase 7: Delivery Status (if admin key available) ==="

if [ -n "$ADMIN_API_KEY" ]; then
  # Wait a moment for queue processing
  echo "    Waiting 3s for queue processing..."
  sleep 3

  # Check delivery status by trace ID
  DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?traceId=$TRACE_ID" \
    -H "X-Admin-Key: $ADMIN_API_KEY")

  OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
  check_result "Delivery status by traceId" "$OK" ""

  if [ "$OK" = "true" ]; then
    # Parse delivery results
    CONVEX_OK=$(echo "$DELIVERY_RESP" | jq '[.events[].convexDeliveredAt | select(. != null)] | length' 2>/dev/null || echo "0")
    TOTAL=$(echo "$DELIVERY_RESP" | jq '.events | length' 2>/dev/null || echo "0")
    echo "    Convex delivered: $CONVEX_OK / $TOTAL"
  fi
else
  echo "    Skipping (no ADMIN_API_KEY)"
fi

echo ""
echo "=== Phase 8: Brain Query ==="

BRAIN_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/brain/query" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "query": "What events happened today?" }')

OK=$(echo "$BRAIN_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
LEVEL=$(echo "$BRAIN_RESP" | jq -r '.personalizationLevel' 2>/dev/null || echo "unknown")
check_result "Brain query" "$OK" "personalizationLevel: $LEVEL"

echo ""
echo "=============================================="
echo "  Golden Flow Test Complete"
echo "=============================================="
echo ""
echo "Trace ID: $TRACE_ID"
echo "Events:   ${EVENT_IDS[*]}"
echo ""
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
