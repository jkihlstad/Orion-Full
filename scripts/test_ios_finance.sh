#!/bin/bash
# iOS Finance App Test Suite for Edge Gateway
# Tests the complete finance event pipeline: Consent -> Ingest -> D1 -> Queue -> Fanout
#
# Usage: ./scripts/test_ios_finance.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (required)

set -euo pipefail

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"

echo "=============================================="
echo "  iOS Finance App Test Suite"
echo "  Edge Gateway Event Pipeline Tests"
echo "=============================================="
echo "Gateway:  $GATEWAY_URL"
echo ""

# Validate required env vars
if [ -z "${TEST_JWT:-}" ]; then
  echo "ERROR: TEST_JWT environment variable is required"
  exit 1
fi

if [ -z "${TEST_USER_ID:-}" ]; then
  echo "ERROR: TEST_USER_ID environment variable is required"
  exit 1
fi

if [ -z "${ADMIN_API_KEY:-}" ]; then
  echo "ERROR: ADMIN_API_KEY environment variable is required"
  exit 1
fi

PASS=0
FAIL=0
EVENT_IDS=()
CONSENT_VERSION="2026-01-11"

# ============================================================================
# Helper Functions
# ============================================================================

check_result() {
  local name="$1"
  local condition="$2"
  local details="${3:-}"

  printf "%-50s " "$name..."
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

generate_trace_id() {
  echo "finance_$(date +%s%N)_$$_$RANDOM"
}

generate_uuid() {
  # Generate a UUID-like string
  printf '%s-%s-%s-%s-%s' \
    "$(head -c 4 /dev/urandom | xxd -p)" \
    "$(head -c 2 /dev/urandom | xxd -p)" \
    "$(head -c 2 /dev/urandom | xxd -p)" \
    "$(head -c 2 /dev/urandom | xxd -p)" \
    "$(head -c 6 /dev/urandom | xxd -p)"
}

# Send event and capture response
send_event() {
  local event_type="$1"
  local trace_id="$2"
  local payload="$3"
  local event_id
  local idem_key
  local timestamp

  event_id=$(generate_uuid)
  idem_key="idem_$(generate_uuid)"
  timestamp=$(($(date +%s) * 1000))

  local response
  response=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -H "X-Trace-Id: $trace_id" \
    -d '{
      "eventId": "'"$event_id"'",
      "userId": "'"$TEST_USER_ID"'",
      "sourceApp": "finance",
      "eventType": "'"$event_type"'",
      "timestamp": '"$timestamp"',
      "privacyScope": "private",
      "consentVersion": "'"$CONSENT_VERSION"'",
      "idempotencyKey": "'"$idem_key"'",
      "payload": '"$payload"'
    }')

  # Return eventId and response
  echo "$event_id|$response"
}

# Verify event delivery status
verify_delivery() {
  local event_id="$1"
  local max_retries=5
  local retry_delay=2
  local retry=0

  while [ $retry -lt $max_retries ]; do
    local status_resp
    status_resp=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    local ok
    ok=$(echo "$status_resp" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$ok" = "true" ]; then
      echo "$status_resp"
      return 0
    fi

    ((retry++))
    sleep $retry_delay
  done

  echo '{"ok": false, "error": "timeout"}'
  return 1
}

# ============================================================================
# Phase 1: Health Check
# ============================================================================

echo "=== Phase 1: Health Check ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
check_result "Gateway health" "$([ "$STATUS" = "200" ] && echo true || echo false)" "HTTP $STATUS"

echo ""

# ============================================================================
# Phase 2: Enable Required Consent Scopes
# ============================================================================

echo "=== Phase 2: Enable Finance Consent Scopes ==="

# Enable all required finance scopes
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "'"$CONSENT_VERSION"'",
    "updates": {
      "finance.transactions": true,
      "finance.budgets": true,
      "finance.receipts": true,
      "finance.credit": true,
      "finance.subscriptions": true,
      "finance.insights": true
    }
  }')

OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
UPDATED=$(echo "$CONSENT_RESP" | jq -r '.updated | join(", ")' 2>/dev/null || echo "none")
check_result "Enable finance consent scopes" "$OK" "Updated: $UPDATED"

# Verify consent was set
CONSENT_GET=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")

TRANSACTIONS_ENABLED=$(echo "$CONSENT_GET" | jq -r '.scopes["finance.transactions"]' 2>/dev/null || echo "false")
check_result "Verify finance.transactions enabled" "$TRANSACTIONS_ENABLED" ""

echo ""

# ============================================================================
# Phase 3: Test Finance Events
# ============================================================================

echo "=== Phase 3: Finance Event Ingestion Tests ==="
echo ""

# ---------------------------------------------------------------------------
# Test 1: finance.transaction_created
# ---------------------------------------------------------------------------
echo "--- Test: finance.transaction_created ---"
TRACE_ID_1=$(generate_trace_id)
TRANSACTION_ID=$(generate_uuid)
PAYLOAD_1='{
  "transactionId": "'"$TRANSACTION_ID"'",
  "amount": 47.99,
  "currency": "USD",
  "merchant": "Whole Foods Market",
  "merchantCategory": "Groceries",
  "category": "food_and_drink",
  "transactionDate": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "accountRef": "checking_****1234",
  "pending": false,
  "location": {
    "city": "San Francisco",
    "state": "CA"
  }
}'

RESULT_1=$(send_event "finance.transaction_created" "$TRACE_ID_1" "$PAYLOAD_1")
EVENT_ID_1=$(echo "$RESULT_1" | cut -d'|' -f1)
RESP_1=$(echo "$RESULT_1" | cut -d'|' -f2)
OK=$(echo "$RESP_1" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.transaction_created" "$OK" "eventId: $EVENT_ID_1"
EVENT_IDS+=("$EVENT_ID_1")

echo ""

# ---------------------------------------------------------------------------
# Test 2: finance.transaction_updated
# ---------------------------------------------------------------------------
echo "--- Test: finance.transaction_updated ---"
TRACE_ID_2=$(generate_trace_id)
PAYLOAD_2='{
  "transactionId": "'"$TRANSACTION_ID"'",
  "changes": {
    "category": {
      "from": "food_and_drink",
      "to": "groceries"
    },
    "merchantNormalized": {
      "from": "WHOLEFDS MKT #10847",
      "to": "Whole Foods Market"
    }
  },
  "updatedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "reason": "user_categorization"
}'

RESULT_2=$(send_event "finance.transaction_updated" "$TRACE_ID_2" "$PAYLOAD_2")
EVENT_ID_2=$(echo "$RESULT_2" | cut -d'|' -f1)
RESP_2=$(echo "$RESULT_2" | cut -d'|' -f2)
OK=$(echo "$RESP_2" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.transaction_updated" "$OK" "eventId: $EVENT_ID_2"
EVENT_IDS+=("$EVENT_ID_2")

echo ""

# ---------------------------------------------------------------------------
# Test 3: finance.account_synced
# ---------------------------------------------------------------------------
echo "--- Test: finance.account_synced ---"
TRACE_ID_3=$(generate_trace_id)
PAYLOAD_3='{
  "accountRef": "checking_****1234",
  "institutionId": "ins_109508",
  "institutionName": "Chase",
  "transactionCount": 47,
  "balanceSnapshot": {
    "available": 3245.67,
    "current": 3245.67,
    "currency": "USD"
  },
  "syncedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "newTransactions": 5,
  "updatedTransactions": 2
}'

RESULT_3=$(send_event "finance.account_synced" "$TRACE_ID_3" "$PAYLOAD_3")
EVENT_ID_3=$(echo "$RESULT_3" | cut -d'|' -f1)
RESP_3=$(echo "$RESULT_3" | cut -d'|' -f2)
OK=$(echo "$RESP_3" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.account_synced" "$OK" "eventId: $EVENT_ID_3"
EVENT_IDS+=("$EVENT_ID_3")

echo ""

# ---------------------------------------------------------------------------
# Test 4: finance.budget_created
# ---------------------------------------------------------------------------
echo "--- Test: finance.budget_created ---"
TRACE_ID_4=$(generate_trace_id)
BUDGET_ID=$(generate_uuid)
PAYLOAD_4='{
  "budgetId": "'"$BUDGET_ID"'",
  "category": "food_and_drink",
  "categoryLabel": "Food & Drink",
  "amount": 600.00,
  "currency": "USD",
  "period": "monthly",
  "periodStartDay": 1,
  "alertThresholds": [50, 80, 100],
  "createdAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}'

RESULT_4=$(send_event "finance.budget_created" "$TRACE_ID_4" "$PAYLOAD_4")
EVENT_ID_4=$(echo "$RESULT_4" | cut -d'|' -f1)
RESP_4=$(echo "$RESULT_4" | cut -d'|' -f2)
OK=$(echo "$RESP_4" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.budget_created" "$OK" "eventId: $EVENT_ID_4"
EVENT_IDS+=("$EVENT_ID_4")

echo ""

# ---------------------------------------------------------------------------
# Test 5: finance.budget_threshold_crossed
# ---------------------------------------------------------------------------
echo "--- Test: finance.budget_threshold_crossed ---"
TRACE_ID_5=$(generate_trace_id)
PAYLOAD_5='{
  "budgetId": "'"$BUDGET_ID"'",
  "category": "food_and_drink",
  "thresholdPercent": 80,
  "budgetAmount": 600.00,
  "currentSpend": 487.23,
  "remainingAmount": 112.77,
  "currency": "USD",
  "daysRemaining": 8,
  "projectedOverage": 45.50,
  "triggeredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}'

RESULT_5=$(send_event "finance.budget_threshold_crossed" "$TRACE_ID_5" "$PAYLOAD_5")
EVENT_ID_5=$(echo "$RESULT_5" | cut -d'|' -f1)
RESP_5=$(echo "$RESULT_5" | cut -d'|' -f2)
OK=$(echo "$RESP_5" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.budget_threshold_crossed" "$OK" "eventId: $EVENT_ID_5"
EVENT_IDS+=("$EVENT_ID_5")

echo ""

# ---------------------------------------------------------------------------
# Test 6: finance.spending_anomaly_detected
# ---------------------------------------------------------------------------
echo "--- Test: finance.spending_anomaly_detected ---"
TRACE_ID_6=$(generate_trace_id)
ANOMALY_TX_ID=$(generate_uuid)
PAYLOAD_6='{
  "transactionId": "'"$ANOMALY_TX_ID"'",
  "anomalyType": "unusually_large_purchase",
  "merchant": "Best Buy",
  "category": "electronics",
  "expectedAmount": {
    "min": 50.00,
    "max": 150.00,
    "average": 89.45
  },
  "actualAmount": 1299.99,
  "currency": "USD",
  "confidence": 0.92,
  "historicalContext": {
    "avgTransactionCount": 2.3,
    "avgTransactionAmount": 89.45,
    "periodDays": 90
  },
  "detectedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}'

RESULT_6=$(send_event "finance.spending_anomaly_detected" "$TRACE_ID_6" "$PAYLOAD_6")
EVENT_ID_6=$(echo "$RESULT_6" | cut -d'|' -f1)
RESP_6=$(echo "$RESULT_6" | cut -d'|' -f2)
OK=$(echo "$RESP_6" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.spending_anomaly_detected" "$OK" "eventId: $EVENT_ID_6"
EVENT_IDS+=("$EVENT_ID_6")

echo ""

# ---------------------------------------------------------------------------
# Test 7: finance.subscription_detected
# ---------------------------------------------------------------------------
echo "--- Test: finance.subscription_detected ---"
TRACE_ID_7=$(generate_trace_id)
SUBSCRIPTION_ID=$(generate_uuid)
PAYLOAD_7='{
  "subscriptionId": "'"$SUBSCRIPTION_ID"'",
  "merchant": "Netflix",
  "merchantLogo": "https://logo.clearbit.com/netflix.com",
  "amount": 15.99,
  "currency": "USD",
  "frequency": "monthly",
  "nextBillingDate": "'"$(date -u -d "+30 days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+30d +%Y-%m-%dT%H:%M:%SZ)"'",
  "category": "entertainment",
  "detectionConfidence": 0.98,
  "firstSeenAt": "'"$(date -u -d "-60 days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-60d +%Y-%m-%dT%H:%M:%SZ)"'",
  "occurrences": 3,
  "accountRef": "checking_****1234"
}'

RESULT_7=$(send_event "finance.subscription_detected" "$TRACE_ID_7" "$PAYLOAD_7")
EVENT_ID_7=$(echo "$RESULT_7" | cut -d'|' -f1)
RESP_7=$(echo "$RESULT_7" | cut -d'|' -f2)
OK=$(echo "$RESP_7" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.subscription_detected" "$OK" "eventId: $EVENT_ID_7"
EVENT_IDS+=("$EVENT_ID_7")

echo ""

# ---------------------------------------------------------------------------
# Test 8: finance.subscription_updated
# ---------------------------------------------------------------------------
echo "--- Test: finance.subscription_updated ---"
TRACE_ID_8=$(generate_trace_id)
PAYLOAD_8='{
  "subscriptionId": "'"$SUBSCRIPTION_ID"'",
  "merchant": "Netflix",
  "changes": {
    "amount": {
      "from": 15.99,
      "to": 22.99
    },
    "plan": {
      "from": "Standard",
      "to": "Premium"
    }
  },
  "effectiveDate": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "annualImpact": 84.00,
  "currency": "USD"
}'

RESULT_8=$(send_event "finance.subscription_updated" "$TRACE_ID_8" "$PAYLOAD_8")
EVENT_ID_8=$(echo "$RESULT_8" | cut -d'|' -f1)
RESP_8=$(echo "$RESULT_8" | cut -d'|' -f2)
OK=$(echo "$RESP_8" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.subscription_updated" "$OK" "eventId: $EVENT_ID_8"
EVENT_IDS+=("$EVENT_ID_8")

echo ""

# ---------------------------------------------------------------------------
# Test 9: finance.plaid_item_linked
# ---------------------------------------------------------------------------
echo "--- Test: finance.plaid_item_linked ---"
TRACE_ID_9=$(generate_trace_id)
ITEM_ID=$(generate_uuid)
PAYLOAD_9='{
  "itemId": "'"$ITEM_ID"'",
  "institutionId": "ins_109508",
  "institutionName": "Chase",
  "institutionLogo": "https://logo.clearbit.com/chase.com",
  "accountsLinked": 2,
  "accountTypes": ["checking", "savings"],
  "linkedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "consentGranted": true,
  "productsEnabled": ["transactions", "auth", "balance"]
}'

RESULT_9=$(send_event "finance.plaid_item_linked" "$TRACE_ID_9" "$PAYLOAD_9")
EVENT_ID_9=$(echo "$RESULT_9" | cut -d'|' -f1)
RESP_9=$(echo "$RESULT_9" | cut -d'|' -f2)
OK=$(echo "$RESP_9" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.plaid_item_linked" "$OK" "eventId: $EVENT_ID_9"
EVENT_IDS+=("$EVENT_ID_9")

echo ""

# ---------------------------------------------------------------------------
# Test 10: finance.receipt_ocr_completed
# ---------------------------------------------------------------------------
echo "--- Test: finance.receipt_ocr_completed ---"
TRACE_ID_10=$(generate_trace_id)
RECEIPT_ID=$(generate_uuid)
PAYLOAD_10='{
  "receiptId": "'"$RECEIPT_ID"'",
  "transactionId": "'"$TRANSACTION_ID"'",
  "merchantExtracted": "Whole Foods Market",
  "merchantConfidence": 0.95,
  "totalExtracted": 47.99,
  "totalConfidence": 0.98,
  "dateExtracted": "'"$(date -u +%Y-%m-%d)"'",
  "dateConfidence": 0.92,
  "currency": "USD",
  "lineItemsCount": 8,
  "taxExtracted": 3.84,
  "processingTimeMs": 1250,
  "ocrEngine": "google_vision_v2"
}'

RESULT_10=$(send_event "finance.receipt_ocr_completed" "$TRACE_ID_10" "$PAYLOAD_10")
EVENT_ID_10=$(echo "$RESULT_10" | cut -d'|' -f1)
RESP_10=$(echo "$RESULT_10" | cut -d'|' -f2)
OK=$(echo "$RESP_10" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.receipt_ocr_completed" "$OK" "eventId: $EVENT_ID_10"
EVENT_IDS+=("$EVENT_ID_10")

echo ""

# ---------------------------------------------------------------------------
# Test 11: finance.insight_generated
# ---------------------------------------------------------------------------
echo "--- Test: finance.insight_generated ---"
TRACE_ID_11=$(generate_trace_id)
INSIGHT_ID=$(generate_uuid)
PAYLOAD_11='{
  "insightId": "'"$INSIGHT_ID"'",
  "insightType": "spending_trend",
  "insightText": "Your grocery spending is 23% higher this month compared to your 3-month average.",
  "severity": "info",
  "relevantTransactions": [
    "'"$TRANSACTION_ID"'",
    "'"$ANOMALY_TX_ID"'"
  ],
  "category": "food_and_drink",
  "metrics": {
    "currentMonthSpend": 523.45,
    "averageMonthSpend": 425.60,
    "percentChange": 23.0
  },
  "actionable": true,
  "suggestedAction": "Consider setting a budget for groceries",
  "generatedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}'

RESULT_11=$(send_event "finance.insight_generated" "$TRACE_ID_11" "$PAYLOAD_11")
EVENT_ID_11=$(echo "$RESULT_11" | cut -d'|' -f1)
RESP_11=$(echo "$RESULT_11" | cut -d'|' -f2)
OK=$(echo "$RESP_11" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Ingest finance.insight_generated" "$OK" "eventId: $EVENT_ID_11"
EVENT_IDS+=("$EVENT_ID_11")

echo ""

# ============================================================================
# Phase 4: Verify Events in D1
# ============================================================================

echo "=== Phase 4: Verify Events in D1 ==="

# Check events/mine to verify events were stored
MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20&eventType=finance" \
  -H "Authorization: Bearer $TEST_JWT")

OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Finance events stored in D1" "$OK" "Found $COUNT finance events"

echo ""

# ============================================================================
# Phase 5: Verify Delivery Status via Admin API
# ============================================================================

echo "=== Phase 5: Verify Delivery Status ==="
echo "    Waiting 3s for queue processing..."
sleep 3

DELIVERY_VERIFIED=0
DELIVERY_FAILED=0

for event_id in "${EVENT_IDS[@]}"; do
  STATUS_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
    -H "X-Admin-Key: $ADMIN_API_KEY")

  OK=$(echo "$STATUS_RESP" | jq -r '.ok' 2>/dev/null || echo "false")

  if [ "$OK" = "true" ]; then
    EVENT_TYPE=$(echo "$STATUS_RESP" | jq -r '.event.eventType' 2>/dev/null || echo "unknown")
    CONVEX_STATUS=$(echo "$STATUS_RESP" | jq -r '.pipeline.deliveries.ingestion.status' 2>/dev/null || echo "unknown")

    printf "  %-40s " "${event_id:0:20}... ($EVENT_TYPE)"

    if [ "$CONVEX_STATUS" = "delivered" ] || [ "$CONVEX_STATUS" = "pending" ]; then
      echo "OK (convex: $CONVEX_STATUS)"
      ((DELIVERY_VERIFIED++))
    else
      echo "WARN (convex: $CONVEX_STATUS)"
      ((DELIVERY_FAILED++))
    fi
  else
    printf "  %-40s " "${event_id:0:20}..."
    echo "NOT_FOUND"
    ((DELIVERY_FAILED++))
  fi
done

echo ""
check_result "Delivery status verified" "$([ $DELIVERY_VERIFIED -gt 0 ] && echo true || echo false)" "$DELIVERY_VERIFIED verified, $DELIVERY_FAILED issues"

echo ""

# ============================================================================
# Phase 6: Test Recent Events Admin Endpoint
# ============================================================================

echo "=== Phase 6: Admin Recent Events ==="

RECENT_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/recent?eventType=finance.transaction_created&limit=5" \
  -H "X-Admin-Key: $ADMIN_API_KEY")

OK=$(echo "$RECENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RECENT_COUNT=$(echo "$RECENT_RESP" | jq '.events | length' 2>/dev/null || echo "0")
check_result "Admin recent finance events" "$OK" "Found $RECENT_COUNT recent transaction events"

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "=============================================="
echo "  iOS Finance App Test Suite Complete"
echo "=============================================="
echo ""
echo "Events tested:"
echo "  1. finance.transaction_created"
echo "  2. finance.transaction_updated"
echo "  3. finance.account_synced"
echo "  4. finance.budget_created"
echo "  5. finance.budget_threshold_crossed"
echo "  6. finance.spending_anomaly_detected"
echo "  7. finance.subscription_detected"
echo "  8. finance.subscription_updated"
echo "  9. finance.plaid_item_linked"
echo "  10. finance.receipt_ocr_completed"
echo "  11. finance.insight_generated"
echo ""
echo "Event IDs:"
for i in "${!EVENT_IDS[@]}"; do
  echo "  $((i+1)). ${EVENT_IDS[$i]}"
done
echo ""
echo "=============================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "=============================================="
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
