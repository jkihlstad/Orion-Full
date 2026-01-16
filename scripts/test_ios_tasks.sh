#!/bin/bash
# iOS Tasks App Test Script
# Tests the complete tasks event pipeline: Ingest -> D1 -> Queue -> Fanout
#
# Usage: ./scripts/test_ios_tasks.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (required)

set -e

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"

echo "=============================================="
echo "  iOS Tasks App - Event Pipeline Tests"
echo "=============================================="
echo "Gateway:  $GATEWAY_URL"
echo "Date:     $(date -Iseconds)"
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

if [ -z "$ADMIN_API_KEY" ]; then
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

# Generate unique trace ID for each test
generate_trace_id() {
  local prefix="$1"
  echo "${prefix}_$(date +%s)_$$_${RANDOM}"
}

# Check result helper - same pattern as smoke_test.sh
check_result() {
  local name="$1"
  local condition="$2"
  local details="$3"

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

# Generate unique event ID
generate_event_id() {
  local prefix="$1"
  echo "${prefix}_$(date +%s)_$$_${RANDOM}"
}

# Generate unique idempotency key
generate_idem_key() {
  local prefix="$1"
  echo "idem_${prefix}_$(date +%s)_$$_${RANDOM}"
}

# Get current timestamp in milliseconds
get_timestamp_ms() {
  echo $(($(date +%s) * 1000))
}

# Verify event delivery status using admin endpoint
verify_delivery() {
  local event_id="$1"
  local max_wait="${2:-10}"
  local wait_time=0

  while [ $wait_time -lt $max_wait ]; do
    local resp=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    local ok=$(echo "$resp" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$ok" = "true" ]; then
      # Check if event was stored (d1InsertedAtMs not null)
      local stored=$(echo "$resp" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
      if [ "$stored" != "null" ] && [ "$stored" != "" ]; then
        echo "$resp"
        return 0
      fi
    fi

    sleep 1
    ((wait_time++))
  done

  echo '{"ok":false,"error":"timeout waiting for event"}'
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
# Phase 2: Consent Setup
# ============================================================================

echo "=== Phase 2: Consent Setup ==="
echo "    Enabling required scopes: tasks.items, tasks.automation"

CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "'"$CONSENT_VERSION"'",
    "updates": {
      "tasks.items": true,
      "tasks.automation": true
    }
  }')

CONSENT_OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Enable tasks.items consent" "$CONSENT_OK" ""
check_result "Enable tasks.automation consent" "$CONSENT_OK" ""

# Verify consent was set
CONSENT_GET=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")

TASKS_ITEMS=$(echo "$CONSENT_GET" | jq -r '.scopes["tasks.items"]' 2>/dev/null || echo "false")
TASKS_AUTOMATION=$(echo "$CONSENT_GET" | jq -r '.scopes["tasks.automation"]' 2>/dev/null || echo "false")

check_result "Verify tasks.items enabled" "$TASKS_ITEMS" ""
check_result "Verify tasks.automation enabled" "$TASKS_AUTOMATION" ""

echo ""

# ============================================================================
# Phase 3: Test tasks.task_created
# ============================================================================

echo "=== Phase 3: Test tasks.task_created ==="

TRACE_ID_1=$(generate_trace_id "task_created")
EVENT_ID_1=$(generate_event_id "task_created")
IDEM_KEY_1=$(generate_idem_key "task_created")
TIMESTAMP_1=$(get_timestamp_ms)
DUE_DATE=$(date -v+7d +%Y-%m-%dT10:00:00Z 2>/dev/null || date -d "+7 days" +%Y-%m-%dT10:00:00Z 2>/dev/null || echo "2026-01-21T10:00:00Z")

echo "    Trace ID: $TRACE_ID_1"
echo "    Event ID: $EVENT_ID_1"

RESP_1=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_1" \
  -d '{
    "eventId": "'"$EVENT_ID_1"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_created",
    "timestamp": '"$TIMESTAMP_1"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_1"'",
    "payload": {
      "taskId": "task_'"$RANDOM"'",
      "title": "Complete iOS Tasks integration testing",
      "description": "Run all test cases for the iOS Tasks app event pipeline to ensure proper data flow",
      "priority": "high",
      "dueDate": "'"$DUE_DATE"'",
      "project": "Orion Mobile Apps",
      "tags": ["testing", "integration", "ios", "critical"]
    }
  }')

OK_1=$(echo "$RESP_1" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_created ingest" "$OK_1" "eventId: $EVENT_ID_1"
EVENT_IDS+=("$EVENT_ID_1")

# Verify in D1
sleep 2
DELIVERY_1=$(verify_delivery "$EVENT_ID_1" 10)
STORED_1=$(echo "$DELIVERY_1" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_created stored in D1" "$([ "$STORED_1" != "null" ] && [ "$STORED_1" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_1"

echo ""

# ============================================================================
# Phase 4: Test tasks.task_updated
# ============================================================================

echo "=== Phase 4: Test tasks.task_updated ==="

TRACE_ID_2=$(generate_trace_id "task_updated")
EVENT_ID_2=$(generate_event_id "task_updated")
IDEM_KEY_2=$(generate_idem_key "task_updated")
TIMESTAMP_2=$(get_timestamp_ms)

echo "    Trace ID: $TRACE_ID_2"
echo "    Event ID: $EVENT_ID_2"

RESP_2=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_2" \
  -d '{
    "eventId": "'"$EVENT_ID_2"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_updated",
    "timestamp": '"$TIMESTAMP_2"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_2"'",
    "payload": {
      "taskId": "task_'"$RANDOM"'",
      "changes": {
        "priority": {"from": "medium", "to": "high"},
        "dueDate": {"from": "2026-01-20T10:00:00Z", "to": "2026-01-18T10:00:00Z"},
        "tags": {"added": ["urgent"], "removed": []}
      },
      "previousStatus": "in_progress",
      "newStatus": "in_progress"
    }
  }')

OK_2=$(echo "$RESP_2" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_updated ingest" "$OK_2" "eventId: $EVENT_ID_2"
EVENT_IDS+=("$EVENT_ID_2")

# Verify in D1
sleep 2
DELIVERY_2=$(verify_delivery "$EVENT_ID_2" 10)
STORED_2=$(echo "$DELIVERY_2" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_updated stored in D1" "$([ "$STORED_2" != "null" ] && [ "$STORED_2" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_2"

echo ""

# ============================================================================
# Phase 5: Test tasks.task_completed
# ============================================================================

echo "=== Phase 5: Test tasks.task_completed ==="

TRACE_ID_3=$(generate_trace_id "task_completed")
EVENT_ID_3=$(generate_event_id "task_completed")
IDEM_KEY_3=$(generate_idem_key "task_completed")
TIMESTAMP_3=$(get_timestamp_ms)
COMPLETED_AT=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)

echo "    Trace ID: $TRACE_ID_3"
echo "    Event ID: $EVENT_ID_3"

RESP_3=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_3" \
  -d '{
    "eventId": "'"$EVENT_ID_3"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_completed",
    "timestamp": '"$TIMESTAMP_3"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_3"'",
    "payload": {
      "taskId": "task_'"$RANDOM"'",
      "completedAt": "'"$COMPLETED_AT"'",
      "actualMinutes": 45
    }
  }')

OK_3=$(echo "$RESP_3" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_completed ingest" "$OK_3" "eventId: $EVENT_ID_3"
EVENT_IDS+=("$EVENT_ID_3")

# Verify in D1
sleep 2
DELIVERY_3=$(verify_delivery "$EVENT_ID_3" 10)
STORED_3=$(echo "$DELIVERY_3" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_completed stored in D1" "$([ "$STORED_3" != "null" ] && [ "$STORED_3" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_3"

echo ""

# ============================================================================
# Phase 6: Test tasks.task_deleted
# ============================================================================

echo "=== Phase 6: Test tasks.task_deleted ==="

TRACE_ID_4=$(generate_trace_id "task_deleted")
EVENT_ID_4=$(generate_event_id "task_deleted")
IDEM_KEY_4=$(generate_idem_key "task_deleted")
TIMESTAMP_4=$(get_timestamp_ms)

echo "    Trace ID: $TRACE_ID_4"
echo "    Event ID: $EVENT_ID_4"

RESP_4=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_4" \
  -d '{
    "eventId": "'"$EVENT_ID_4"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_deleted",
    "timestamp": '"$TIMESTAMP_4"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_4"'",
    "payload": {
      "taskId": "task_'"$RANDOM"'",
      "reason": "duplicate_task"
    }
  }')

OK_4=$(echo "$RESP_4" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_deleted ingest" "$OK_4" "eventId: $EVENT_ID_4"
EVENT_IDS+=("$EVENT_ID_4")

# Verify in D1
sleep 2
DELIVERY_4=$(verify_delivery "$EVENT_ID_4" 10)
STORED_4=$(echo "$DELIVERY_4" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_deleted stored in D1" "$([ "$STORED_4" != "null" ] && [ "$STORED_4" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_4"

echo ""

# ============================================================================
# Phase 7: Test tasks.task_generated_from_calendar
# ============================================================================

echo "=== Phase 7: Test tasks.task_generated_from_calendar ==="

TRACE_ID_5=$(generate_trace_id "task_from_cal")
EVENT_ID_5=$(generate_event_id "task_from_cal")
IDEM_KEY_5=$(generate_idem_key "task_from_cal")
TIMESTAMP_5=$(get_timestamp_ms)

echo "    Trace ID: $TRACE_ID_5"
echo "    Event ID: $EVENT_ID_5"

RESP_5=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_5" \
  -d '{
    "eventId": "'"$EVENT_ID_5"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_generated_from_calendar",
    "timestamp": '"$TIMESTAMP_5"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_5"'",
    "payload": {
      "taskId": "task_auto_'"$RANDOM"'",
      "sourceEventId": "cal_event_'"$RANDOM"'",
      "title": "Prepare presentation for Q1 Planning Meeting"
    }
  }')

OK_5=$(echo "$RESP_5" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_generated_from_calendar ingest" "$OK_5" "eventId: $EVENT_ID_5"
EVENT_IDS+=("$EVENT_ID_5")

# Verify in D1
sleep 2
DELIVERY_5=$(verify_delivery "$EVENT_ID_5" 10)
STORED_5=$(echo "$DELIVERY_5" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_generated_from_calendar stored in D1" "$([ "$STORED_5" != "null" ] && [ "$STORED_5" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_5"

echo ""

# ============================================================================
# Phase 8: Test tasks.task_generated_from_email
# ============================================================================

echo "=== Phase 8: Test tasks.task_generated_from_email ==="

TRACE_ID_6=$(generate_trace_id "task_from_email")
EVENT_ID_6=$(generate_event_id "task_from_email")
IDEM_KEY_6=$(generate_idem_key "task_from_email")
TIMESTAMP_6=$(get_timestamp_ms)

echo "    Trace ID: $TRACE_ID_6"
echo "    Event ID: $EVENT_ID_6"

RESP_6=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_6" \
  -d '{
    "eventId": "'"$EVENT_ID_6"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "tasks",
    "eventType": "tasks.task_generated_from_email",
    "timestamp": '"$TIMESTAMP_6"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "'"$IDEM_KEY_6"'",
    "payload": {
      "taskId": "task_email_'"$RANDOM"'",
      "sourceMessageId": "msg_'"$RANDOM"'@mail.example.com",
      "title": "Review and respond to client proposal"
    }
  }')

OK_6=$(echo "$RESP_6" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "tasks.task_generated_from_email ingest" "$OK_6" "eventId: $EVENT_ID_6"
EVENT_IDS+=("$EVENT_ID_6")

# Verify in D1
sleep 2
DELIVERY_6=$(verify_delivery "$EVENT_ID_6" 10)
STORED_6=$(echo "$DELIVERY_6" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")
check_result "tasks.task_generated_from_email stored in D1" "$([ "$STORED_6" != "null" ] && [ "$STORED_6" != "" ] && echo true || echo false)" "d1InsertedAtMs: $STORED_6"

echo ""

# ============================================================================
# Phase 9: Verify All Events via Admin Endpoint
# ============================================================================

echo "=== Phase 9: Verify All Events via Admin Endpoint ==="

for event_id in "${EVENT_IDS[@]}"; do
  DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
    -H "X-Admin-Key: $ADMIN_API_KEY")

  DELIVERY_OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
  EVENT_TYPE=$(echo "$DELIVERY_RESP" | jq -r '.event.eventType' 2>/dev/null || echo "unknown")

  check_result "Admin verify: $event_id" "$DELIVERY_OK" "eventType: $EVENT_TYPE"
done

echo ""

# ============================================================================
# Phase 10: Verify Events in events/mine
# ============================================================================

echo "=== Phase 10: Verify Events in events/mine ==="

MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20&eventType=tasks" \
  -H "Authorization: Bearer $TEST_JWT")

MINE_OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
MINE_COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")

check_result "Fetch user events (events/mine)" "$MINE_OK" "found $MINE_COUNT events"

# Count tasks events
TASKS_CREATED=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "tasks.task_created")] | length' 2>/dev/null || echo "0")
TASKS_UPDATED=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "tasks.task_updated")] | length' 2>/dev/null || echo "0")
TASKS_COMPLETED=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "tasks.task_completed")] | length' 2>/dev/null || echo "0")
TASKS_DELETED=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "tasks.task_deleted")] | length' 2>/dev/null || echo "0")

echo "    tasks.task_created: $TASKS_CREATED"
echo "    tasks.task_updated: $TASKS_UPDATED"
echo "    tasks.task_completed: $TASKS_COMPLETED"
echo "    tasks.task_deleted: $TASKS_DELETED"

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "=============================================="
echo "  iOS Tasks App Test Complete"
echo "=============================================="
echo ""
echo "Events tested:"
for event_id in "${EVENT_IDS[@]}"; do
  echo "  - $event_id"
done
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
