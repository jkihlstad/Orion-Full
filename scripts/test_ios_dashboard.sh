#!/bin/bash
# iOS Dashboard Test Script for Edge Gateway
# Tests dashboard events for the iOS dashboard app (ios-dashboard)
#
# Usage: ./scripts/test_ios_dashboard.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (required)

set -euo pipefail

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"

echo "=============================================================="
echo "  iOS Dashboard Test Suite - Edge Gateway"
echo "=============================================================="
echo "Gateway:  $GATEWAY_URL"
echo "Started:  $(date -Iseconds)"
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
TRACE_IDS=()

# Generate unique base ID for this test run
RUN_ID="ios_dash_$(date +%s)_$$"

# Helper function - check_result pattern from smoke_test.sh
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

# Helper function to generate unique trace ID for each test
generate_trace_id() {
  local test_name="$1"
  echo "trace_${RUN_ID}_${test_name}"
}

# Helper function to generate unique event ID
generate_event_id() {
  local test_name="$1"
  echo "evt_${RUN_ID}_${test_name}"
}

# Helper function to generate unique idempotency key
generate_idem_key() {
  local test_name="$1"
  echo "idem_${RUN_ID}_${test_name}"
}

# Helper function to send event and check result
send_event() {
  local test_name="$1"
  local event_type="$2"
  local payload="$3"

  local trace_id
  trace_id=$(generate_trace_id "$test_name")
  local event_id
  event_id=$(generate_event_id "$test_name")
  local idem_key
  idem_key=$(generate_idem_key "$test_name")
  local timestamp=$(($(date +%s) * 1000))

  # Store for later verification
  EVENT_IDS+=("$event_id")
  TRACE_IDS+=("$trace_id")

  local resp
  resp=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -H "X-Trace-Id: $trace_id" \
    -d '{
      "eventId": "'"$event_id"'",
      "userId": "'"$TEST_USER_ID"'",
      "sourceApp": "dashboard",
      "eventType": "'"$event_type"'",
      "timestamp": '"$timestamp"',
      "privacyScope": "private",
      "consentVersion": "2026-01-11",
      "idempotencyKey": "'"$idem_key"'",
      "payload": '"$payload"'
    }')

  local ok
  ok=$(echo "$resp" | jq -r '.ok' 2>/dev/null || echo "false")
  local returned_id
  returned_id=$(echo "$resp" | jq -r '.eventId' 2>/dev/null || echo "")

  check_result "Ingest: $test_name" "$ok" "eventId: $returned_id, traceId: $trace_id"

  echo "$event_id"
}

# Helper function to verify event in D1 via admin endpoint
verify_event_stored() {
  local event_id="$1"
  local test_name="$2"

  local resp
  resp=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
    -H "X-Admin-Key: $ADMIN_API_KEY")

  local ok
  ok=$(echo "$resp" | jq -r '.ok' 2>/dev/null || echo "false")
  local stored_event_id
  stored_event_id=$(echo "$resp" | jq -r '.event.eventId' 2>/dev/null || echo "")
  local event_type
  event_type=$(echo "$resp" | jq -r '.event.eventType' 2>/dev/null || echo "")

  check_result "Verify stored: $test_name" "$([ "$ok" = "true" ] && [ "$stored_event_id" = "$event_id" ] && echo true || echo false)" "eventType: $event_type"
}

echo "=== Phase 1: Health Check ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
check_result "Gateway health" "$([ "$STATUS" = "200" ] && echo true || echo false)" "HTTP $STATUS"

echo ""
echo "=== Phase 2: Consent Setup ==="

# Enable the required consent scope for telemetry
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "2026-01-11",
    "updates": {
      "system.telemetry_basic": true
    }
  }')

CONSENT_OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Enable consent: system.telemetry_basic" "$CONSENT_OK" ""

# Verify consent was set
CONSENT_GET_RESP=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")
TELEMETRY_ENABLED=$(echo "$CONSENT_GET_RESP" | jq -r '.scopes["system.telemetry_basic"] // false' 2>/dev/null || echo "false")
check_result "Verify consent enabled" "$TELEMETRY_ENABLED" ""

echo ""
echo "=== Phase 3: Dashboard Event Ingestion ==="

# Test 1: dashboard.session_started
echo ""
echo "--- Test 1: dashboard.session_started ---"
SESSION_PAYLOAD='{
  "sessionId": "sess_'"$RUN_ID"'",
  "deviceType": "iPhone",
  "appVersion": "1.2.3",
  "osVersion": "iOS 17.2",
  "deviceModel": "iPhone 15 Pro",
  "locale": "en-US",
  "timezone": "America/Los_Angeles",
  "startedAtMs": '"$(($(date +%s) * 1000))"'
}'
SESSION_EVENT_ID=$(send_event "session_started" "system.app_opened" "$SESSION_PAYLOAD")

# Test 2: dashboard.screen_viewed
echo ""
echo "--- Test 2: dashboard.screen_viewed ---"
SCREEN_PAYLOAD='{
  "screenName": "HomeScreen",
  "previousScreen": null,
  "viewDurationMs": 0,
  "screenClass": "HomeViewController",
  "navigationSource": "app_launch",
  "timestamp": '"$(($(date +%s) * 1000))"'
}'
SCREEN_EVENT_ID=$(send_event "screen_viewed_home" "system.app_opened" "$SCREEN_PAYLOAD")

# Test 3: dashboard.screen_viewed (with previous screen and duration)
echo ""
echo "--- Test 3: dashboard.screen_viewed (navigation) ---"
SCREEN_NAV_PAYLOAD='{
  "screenName": "SettingsScreen",
  "previousScreen": "HomeScreen",
  "viewDurationMs": 12500,
  "screenClass": "SettingsViewController",
  "navigationSource": "tab_bar",
  "timestamp": '"$(($(date +%s) * 1000))"'
}'
SCREEN_NAV_EVENT_ID=$(send_event "screen_viewed_settings" "system.app_opened" "$SCREEN_NAV_PAYLOAD")

# Test 4: dashboard.feature_used
echo ""
echo "--- Test 4: dashboard.feature_used ---"
FEATURE_PAYLOAD='{
  "featureName": "quick_transfer",
  "featureCategory": "payments",
  "metadata": {
    "transferType": "internal",
    "amountRange": "100-500",
    "recipientType": "contact"
  },
  "durationMs": 3200,
  "successful": true
}'
FEATURE_EVENT_ID=$(send_event "feature_used" "system.app_opened" "$FEATURE_PAYLOAD")

# Test 5: dashboard.profile_updated
echo ""
echo "--- Test 5: dashboard.profile_updated ---"
PROFILE_PAYLOAD='{
  "fieldUpdated": "display_name",
  "previousValue": "John",
  "newValue": "Johnny",
  "updateSource": "settings_screen",
  "validationPassed": true
}'
PROFILE_EVENT_ID=$(send_event "profile_updated" "system.app_opened" "$PROFILE_PAYLOAD")

# Test 6: dashboard.settings_changed
echo ""
echo "--- Test 6: dashboard.settings_changed ---"
SETTINGS_PAYLOAD='{
  "settingName": "notifications_enabled",
  "previousValue": "false",
  "newValue": "true",
  "settingCategory": "privacy",
  "requiresRestart": false
}'
SETTINGS_EVENT_ID=$(send_event "settings_changed" "system.app_opened" "$SETTINGS_PAYLOAD")

# Test 7: dashboard.notification_received
echo ""
echo "--- Test 7: dashboard.notification_received ---"
NOTIF_RECV_PAYLOAD='{
  "notificationType": "transaction_alert",
  "source": "push",
  "wasRead": false,
  "notificationId": "notif_'"$RUN_ID"'_001",
  "priority": "high",
  "receivedAtMs": '"$(($(date +%s) * 1000))"'
}'
NOTIF_RECV_EVENT_ID=$(send_event "notification_received" "system.app_opened" "$NOTIF_RECV_PAYLOAD")

# Test 8: dashboard.notification_clicked
echo ""
echo "--- Test 8: dashboard.notification_clicked ---"
NOTIF_CLICK_PAYLOAD='{
  "notificationId": "notif_'"$RUN_ID"'_001",
  "action": "view_transaction",
  "clickedAtMs": '"$(($(date +%s) * 1000))"',
  "timeToClickMs": 5000,
  "actionResult": "navigated"
}'
NOTIF_CLICK_EVENT_ID=$(send_event "notification_clicked" "system.app_opened" "$NOTIF_CLICK_PAYLOAD")

# Test 9: dashboard.error_occurred
echo ""
echo "--- Test 9: dashboard.error_occurred ---"
ERROR_PAYLOAD='{
  "errorType": "network_timeout",
  "errorMessage": "Request timed out after 30000ms",
  "screenName": "TransactionHistoryScreen",
  "errorCode": "ERR_TIMEOUT",
  "stackTrace": null,
  "recoverable": true,
  "userAction": "retry_prompted"
}'
ERROR_EVENT_ID=$(send_event "error_occurred" "system.app_opened" "$ERROR_PAYLOAD")

echo ""
echo "=== Phase 4: Wait for Queue Processing ==="
echo "    Waiting 3s for queue processing..."
sleep 3

echo ""
echo "=== Phase 5: Verify Events Stored in D1 ==="

verify_event_stored "$SESSION_EVENT_ID" "session_started"
verify_event_stored "$SCREEN_EVENT_ID" "screen_viewed_home"
verify_event_stored "$SCREEN_NAV_EVENT_ID" "screen_viewed_navigation"
verify_event_stored "$FEATURE_EVENT_ID" "feature_used"
verify_event_stored "$PROFILE_EVENT_ID" "profile_updated"
verify_event_stored "$SETTINGS_EVENT_ID" "settings_changed"
verify_event_stored "$NOTIF_RECV_EVENT_ID" "notification_received"
verify_event_stored "$NOTIF_CLICK_EVENT_ID" "notification_clicked"
verify_event_stored "$ERROR_EVENT_ID" "error_occurred"

echo ""
echo "=== Phase 6: Verify Delivery Status ==="

# Check delivery status for a sample event
DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$SESSION_EVENT_ID" \
  -H "X-Admin-Key: $ADMIN_API_KEY")

DELIVERY_OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
INGESTION_STATUS=$(echo "$DELIVERY_RESP" | jq -r '.pipeline.deliveries.ingestion.status' 2>/dev/null || echo "unknown")
check_result "Delivery status check" "$DELIVERY_OK" "ingestion: $INGESTION_STATUS"

echo ""
echo "=== Phase 7: Batch Ingest Test ==="

# Test batch ingest with multiple dashboard events
BATCH_EVENT_1="evt_batch1_${RUN_ID}"
BATCH_EVENT_2="evt_batch2_${RUN_ID}"
BATCH_TRACE="trace_batch_${RUN_ID}"
BATCH_TIMESTAMP=$(($(date +%s) * 1000))

BATCH_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingestBatch" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $BATCH_TRACE" \
  -d '{
    "events": [
      {
        "eventId": "'"$BATCH_EVENT_1"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "dashboard",
        "eventType": "system.app_opened",
        "timestamp": '"$BATCH_TIMESTAMP"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "idem_batch1_'"$RUN_ID"'",
        "payload": {
          "screenName": "ProfileScreen",
          "previousScreen": "SettingsScreen",
          "viewDurationMs": 8000,
          "batchTest": true
        }
      },
      {
        "eventId": "'"$BATCH_EVENT_2"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "dashboard",
        "eventType": "system.app_opened",
        "timestamp": '"$((BATCH_TIMESTAMP + 1000))"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "idem_batch2_'"$RUN_ID"'",
        "payload": {
          "screenName": "HelpScreen",
          "previousScreen": "ProfileScreen",
          "viewDurationMs": 15000,
          "batchTest": true
        }
      }
    ]
  }')

BATCH_OK=$(echo "$BATCH_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
BATCH_ACCEPTED=$(echo "$BATCH_RESP" | jq -r '.accepted' 2>/dev/null || echo "0")
check_result "Batch ingest (2 events)" "$([ "$BATCH_OK" = "true" ] && [ "$BATCH_ACCEPTED" = "2" ] && echo true || echo false)" "accepted: $BATCH_ACCEPTED"

EVENT_IDS+=("$BATCH_EVENT_1" "$BATCH_EVENT_2")

echo ""
echo "=== Phase 8: Idempotency Test ==="

# Test that re-sending with same idempotency key gets deduped
IDEM_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: trace_idem_test_$RUN_ID" \
  -d '{
    "eventId": "evt_idem_dup_'"$RUN_ID"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "dashboard",
    "eventType": "system.app_opened",
    "timestamp": '"$(($(date +%s) * 1000))"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$(generate_idem_key "session_started")"'",
    "payload": { "test": "idempotency_duplicate" }
  }')

IDEM_OK=$(echo "$IDEM_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
IDEM_DEDUPED=$(echo "$IDEM_RESP" | jq -r '.deduped' 2>/dev/null || echo "false")
check_result "Idempotency (deduped)" "$([ "$IDEM_OK" = "true" ] && [ "$IDEM_DEDUPED" = "true" ] && echo true || echo false)" "deduped: $IDEM_DEDUPED"

echo ""
echo "=== Phase 9: Events Mine Verification ==="

# Verify events appear in /v1/events/mine
MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20" \
  -H "Authorization: Bearer $TEST_JWT")

MINE_OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
MINE_COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Events mine check" "$MINE_OK" "found $MINE_COUNT recent events"

echo ""
echo "=============================================================="
echo "  iOS Dashboard Test Suite Complete"
echo "=============================================================="
echo ""
echo "Run ID:       $RUN_ID"
echo "Events sent:  ${#EVENT_IDS[@]}"
echo "Event IDs:    ${EVENT_IDS[*]}"
echo ""
echo "=============================================================="
echo "  SUMMARY"
echo "=============================================================="
echo ""
printf "  Passed: %d\n" "$PASS"
printf "  Failed: %d\n" "$FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All $PASS tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed out of $((PASS + FAIL)) total"
  exit 1
fi
