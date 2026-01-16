#!/bin/bash
# Smoke Test for Edge Gateway
# Usage: ./scripts/smoke_test.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT    - Valid Clerk JWT for test user (required for auth endpoints)
#   TEST_USER_ID - User ID matching the JWT (required for ingest)

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"
PASS=0
FAIL=0

echo "=== Edge Gateway Smoke Tests ==="
echo "Gateway: $GATEWAY_URL"
echo ""

# Helper function
test_endpoint() {
  local name="$1"
  local expected_status="$2"
  local actual_status="$3"

  printf "%-30s " "$name..."
  if [ "$actual_status" = "$expected_status" ]; then
    echo "PASS ($actual_status)"
    ((PASS++))
  else
    echo "FAIL (expected $expected_status, got $actual_status)"
    ((FAIL++))
  fi
}

# 1. Health check (no auth required)
echo "--- Public Endpoints ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
test_endpoint "Health check" "200" "$STATUS"

# 2. Consent scopes (no auth required)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/consent/scopes")
test_endpoint "Consent scopes (public)" "200" "$STATUS"

# Check if we have JWT for authenticated tests
if [ -z "$TEST_JWT" ]; then
  echo ""
  echo "--- Skipping Authenticated Tests (no TEST_JWT) ---"
  echo ""
  echo "=== Results: $PASS passed, $FAIL failed ==="
  [ $FAIL -eq 0 ] && exit 0 || exit 1
fi

echo ""
echo "--- Authenticated Endpoints ---"

# 3. Whoami
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/auth/whoami" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Auth whoami" "200" "$STATUS"

# 4. Consent get
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Consent get" "200" "$STATUS"

# 5. Events mine
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/events/mine" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Events mine" "200" "$STATUS"

# 6. Events recent
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/events/recent" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Events recent" "200" "$STATUS"

# 7. Profile get
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/profile/get" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Profile get" "200" "$STATUS"

# 8. Dashboard search
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/v1/dashboard/search?q=test" \
  -H "Authorization: Bearer $TEST_JWT")
test_endpoint "Dashboard search" "200" "$STATUS"

# 9. Event ingest (if TEST_USER_ID is set)
if [ -n "$TEST_USER_ID" ]; then
  echo ""
  echo "--- Event Ingest ---"

  EVENT_ID="smoke_$(date +%s)_$$"
  IDEM_KEY="smoke_idem_$(date +%s)_$$"
  TIMESTAMP=$(($(date +%s) * 1000))

  RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -d '{
      "eventId": "'"$EVENT_ID"'",
      "userId": "'"$TEST_USER_ID"'",
      "sourceApp": "dashboard",
      "eventType": "system.smoke_test",
      "timestamp": '"$TIMESTAMP"',
      "privacyScope": "private",
      "consentVersion": "2026-01-11",
      "idempotencyKey": "'"$IDEM_KEY"'",
      "payload": { "test": true, "timestamp": "'"$(date -Iseconds)"'" }
    }')

  OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "parse_error")
  printf "%-30s " "Event ingest..."
  if [ "$OK" = "true" ]; then
    echo "PASS (eventId: $EVENT_ID)"
    ((PASS++))
  else
    echo "FAIL: $RESP"
    ((FAIL++))
  fi
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
