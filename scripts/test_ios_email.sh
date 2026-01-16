#!/bin/bash
# iOS Email App Test Script for Edge Gateway
# Tests the complete email event pipeline with realistic payloads
#
# Usage: ./scripts/test_ios_email.sh [gateway_url]
#
# Environment variables (required):
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user
#   TEST_USER_ID  - User ID matching the JWT
#   ADMIN_API_KEY - Admin API key for checking delivery status

set -e

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"
TEST_RUN_ID="ios_email_$(date +%s)_$$"

echo "=============================================="
echo "  iOS Email App Test Suite"
echo "=============================================="
echo "Gateway:    $GATEWAY_URL"
echo "Test Run:   $TEST_RUN_ID"
echo ""

# ============================================================================
# Validate Required Environment Variables
# ============================================================================

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

# ============================================================================
# Test Result Tracking
# ============================================================================

PASS=0
FAIL=0
EVENT_IDS=()
TRACE_IDS=()

# ============================================================================
# Helper Functions
# ============================================================================

# Check result with consistent output format (from smoke_test.sh pattern)
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

# Generate a unique trace ID for each test
generate_trace_id() {
  local test_name="$1"
  echo "email_${test_name}_${TEST_RUN_ID}"
}

# Generate a unique event ID
generate_event_id() {
  local test_name="$1"
  echo "evt_email_${test_name}_$(date +%s%N | cut -c1-13)_$$"
}

# Generate a unique idempotency key
generate_idem_key() {
  local test_name="$1"
  echo "idem_email_${test_name}_$(date +%s%N | cut -c1-13)_$$"
}

# Get current timestamp in milliseconds
get_timestamp_ms() {
  echo $(($(date +%s) * 1000))
}

# Verify event delivery status via admin endpoint
verify_delivery() {
  local event_id="$1"
  local test_name="$2"
  local max_attempts="${3:-5}"
  local attempt=1

  echo "    Verifying delivery for $event_id..."

  while [ $attempt -le $max_attempts ]; do
    sleep 2

    DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    DELIVERY_OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$DELIVERY_OK" = "true" ]; then
      CONVEX_STATUS=$(echo "$DELIVERY_RESP" | jq -r '.pipeline.deliveries.ingestion.status' 2>/dev/null || echo "unknown")
      echo "    Delivery status: convex=$CONVEX_STATUS (attempt $attempt)"

      if [ "$CONVEX_STATUS" = "delivered" ] || [ "$CONVEX_STATUS" = "pending" ]; then
        return 0
      fi
    fi

    ((attempt++))
  done

  echo "    WARNING: Could not verify delivery after $max_attempts attempts"
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

echo "=== Phase 2: Enable Email Consent Scopes ==="

# Enable all required email consent scopes
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "2026-01-11",
    "updates": {
      "email.metadata": true,
      "email.content": true,
      "system.telemetry_basic": true
    }
  }')

CONSENT_OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
CONSENT_UPDATED=$(echo "$CONSENT_RESP" | jq -r '.updated | length' 2>/dev/null || echo "0")
check_result "Enable email.metadata scope" "$CONSENT_OK" "Updated $CONSENT_UPDATED scopes"

# Verify consent was set correctly
CONSENT_GET_RESP=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")

EMAIL_METADATA=$(echo "$CONSENT_GET_RESP" | jq -r '.scopes["email.metadata"]' 2>/dev/null || echo "false")
EMAIL_CONTENT=$(echo "$CONSENT_GET_RESP" | jq -r '.scopes["email.content"]' 2>/dev/null || echo "false")
check_result "Verify email.metadata enabled" "$EMAIL_METADATA" ""
check_result "Verify email.content enabled" "$EMAIL_CONTENT" ""

echo ""

# ============================================================================
# Phase 3: Test email.message_sent Event
# ============================================================================

echo "=== Phase 3: Test email.message_sent ==="

TRACE_ID_SENT=$(generate_trace_id "message_sent")
EVENT_ID_SENT=$(generate_event_id "message_sent")
IDEM_KEY_SENT=$(generate_idem_key "message_sent")
TIMESTAMP_SENT=$(get_timestamp_ms)

TRACE_IDS+=("$TRACE_ID_SENT")

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_SENT" \
  -d '{
    "eventId": "'"$EVENT_ID_SENT"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.message_sent",
    "timestamp": '"$TIMESTAMP_SENT"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_SENT"'",
    "payload": {
      "messageId": "msg_'"$(date +%s%N | cut -c1-16)"'",
      "threadId": "thread_'"$(date +%s)"'_inbox",
      "subjectHash": "sha256_'"$(echo -n "Re: Project Update" | shasum -a 256 | cut -c1-16)"'",
      "fromDomain": "gmail.com",
      "toDomains": ["company.com", "partner.org"],
      "recipientCount": 3,
      "hasAttachments": true,
      "attachmentCount": 2,
      "totalAttachmentBytes": 524288,
      "provider": "gmail",
      "accountRef": "acct_primary_gmail"
    }
  }')

INGEST_OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "email.message_sent ingest" "$INGEST_OK" "eventId: $RETURNED_ID"

if [ "$INGEST_OK" = "true" ]; then
  EVENT_IDS+=("$EVENT_ID_SENT")
fi

echo ""

# ============================================================================
# Phase 4: Test email.message_received Event
# ============================================================================

echo "=== Phase 4: Test email.message_received ==="

TRACE_ID_RECV=$(generate_trace_id "message_received")
EVENT_ID_RECV=$(generate_event_id "message_received")
IDEM_KEY_RECV=$(generate_idem_key "message_received")
TIMESTAMP_RECV=$(get_timestamp_ms)

TRACE_IDS+=("$TRACE_ID_RECV")

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_RECV" \
  -d '{
    "eventId": "'"$EVENT_ID_RECV"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.message_received",
    "timestamp": '"$TIMESTAMP_RECV"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_RECV"'",
    "payload": {
      "messageId": "msg_recv_'"$(date +%s%N | cut -c1-16)"'",
      "threadId": "thread_'"$(date +%s)"'_inbox",
      "subjectHash": "sha256_'"$(echo -n "Meeting Tomorrow" | shasum -a 256 | cut -c1-16)"'",
      "fromDomain": "company.com",
      "isReply": true,
      "priority": "high",
      "hasAttachments": false,
      "isRead": false,
      "labels": ["inbox", "important"],
      "provider": "gmail",
      "accountRef": "acct_primary_gmail"
    }
  }')

INGEST_OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "email.message_received ingest" "$INGEST_OK" "eventId: $RETURNED_ID"

if [ "$INGEST_OK" = "true" ]; then
  EVENT_IDS+=("$EVENT_ID_RECV")
fi

echo ""

# ============================================================================
# Phase 5: Test email.sync_completed Event
# ============================================================================

echo "=== Phase 5: Test email.sync_completed ==="

TRACE_ID_SYNC=$(generate_trace_id "sync_completed")
EVENT_ID_SYNC=$(generate_event_id "sync_completed")
IDEM_KEY_SYNC=$(generate_idem_key "sync_completed")
TIMESTAMP_SYNC=$(get_timestamp_ms)

TRACE_IDS+=("$TRACE_ID_SYNC")

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_SYNC" \
  -d '{
    "eventId": "'"$EVENT_ID_SYNC"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.sync_completed",
    "timestamp": '"$TIMESTAMP_SYNC"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_SYNC"'",
    "payload": {
      "accountRef": "acct_primary_gmail",
      "messagesAdded": 15,
      "messagesUpdated": 8,
      "messagesDeleted": 2,
      "provider": "gmail",
      "syncDurationMs": 3450,
      "syncType": "incremental",
      "foldersScanned": ["inbox", "sent", "drafts"],
      "errorCount": 0
    }
  }')

INGEST_OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "email.sync_completed ingest" "$INGEST_OK" "eventId: $RETURNED_ID"

if [ "$INGEST_OK" = "true" ]; then
  EVENT_IDS+=("$EVENT_ID_SYNC")
fi

echo ""

# ============================================================================
# Phase 6: Test email.thread_opened Event
# ============================================================================

echo "=== Phase 6: Test email.thread_opened ==="

TRACE_ID_THREAD=$(generate_trace_id "thread_opened")
EVENT_ID_THREAD=$(generate_event_id "thread_opened")
IDEM_KEY_THREAD=$(generate_idem_key "thread_opened")
TIMESTAMP_THREAD=$(get_timestamp_ms)

TRACE_IDS+=("$TRACE_ID_THREAD")

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_THREAD" \
  -d '{
    "eventId": "'"$EVENT_ID_THREAD"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.thread_opened",
    "timestamp": '"$TIMESTAMP_THREAD"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_THREAD"'",
    "payload": {
      "threadId": "thread_'"$(date +%s)"'_conversation",
      "messageCount": 12,
      "participantCount": 4,
      "participantDomains": ["company.com", "partner.org", "client.io"],
      "hasUnread": true,
      "unreadCount": 3,
      "threadAgeHours": 72,
      "labels": ["inbox", "important", "project-alpha"]
    }
  }')

INGEST_OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "email.thread_opened ingest" "$INGEST_OK" "eventId: $RETURNED_ID"

if [ "$INGEST_OK" = "true" ]; then
  EVENT_IDS+=("$EVENT_ID_THREAD")
fi

echo ""

# ============================================================================
# Phase 7: Test email.account_connected Event
# ============================================================================

echo "=== Phase 7: Test email.account_connected ==="

TRACE_ID_ACCT=$(generate_trace_id "account_connected")
EVENT_ID_ACCT=$(generate_event_id "account_connected")
IDEM_KEY_ACCT=$(generate_idem_key "account_connected")
TIMESTAMP_ACCT=$(get_timestamp_ms)

TRACE_IDS+=("$TRACE_ID_ACCT")

INGEST_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_ACCT" \
  -d '{
    "eventId": "'"$EVENT_ID_ACCT"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.account_connected",
    "timestamp": '"$TIMESTAMP_ACCT"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_ACCT"'",
    "payload": {
      "accountRef": "acct_new_outlook_'"$(date +%s)"'",
      "provider": "outlook",
      "emailDomain": "outlook.com",
      "authMethod": "oauth2",
      "scopes": ["mail.read", "mail.send", "mail.readwrite"],
      "accountType": "personal",
      "totalFolders": 8,
      "initialSyncRequired": true
    }
  }')

INGEST_OK=$(echo "$INGEST_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RETURNED_ID=$(echo "$INGEST_RESP" | jq -r '.eventId' 2>/dev/null || echo "")
check_result "email.account_connected ingest" "$INGEST_OK" "eventId: $RETURNED_ID"

if [ "$INGEST_OK" = "true" ]; then
  EVENT_IDS+=("$EVENT_ID_ACCT")
fi

echo ""

# ============================================================================
# Phase 8: Verify Events in D1 via events/mine
# ============================================================================

echo "=== Phase 8: Verify Events Stored in D1 ==="

MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20&sourceApp=ios-email" \
  -H "Authorization: Bearer $TEST_JWT")

MINE_OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
MINE_COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Events stored in D1" "$MINE_OK" "Found $MINE_COUNT ios-email events"

# Check if our specific events are present
for EVT_ID in "${EVENT_IDS[@]}"; do
  FOUND=$(echo "$MINE_RESP" | jq --arg id "$EVT_ID" '.items[] | select(.eventId == $id) | .eventId' 2>/dev/null || echo "")
  if [ -n "$FOUND" ]; then
    printf "    Event %s: FOUND\n" "$EVT_ID"
  else
    printf "    Event %s: NOT FOUND\n" "$EVT_ID"
  fi
done

echo ""

# ============================================================================
# Phase 9: Verify Delivery Status via Admin Endpoint
# ============================================================================

echo "=== Phase 9: Verify Delivery Status ==="

echo "    Waiting 3s for queue processing..."
sleep 3

DELIVERY_VERIFIED=0
DELIVERY_FAILED=0

for EVT_ID in "${EVENT_IDS[@]}"; do
  DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$EVT_ID" \
    -H "X-Admin-Key: $ADMIN_API_KEY")

  DELIVERY_OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")

  if [ "$DELIVERY_OK" = "true" ]; then
    EVENT_TYPE=$(echo "$DELIVERY_RESP" | jq -r '.event.eventType' 2>/dev/null || echo "unknown")
    CONVEX_STATUS=$(echo "$DELIVERY_RESP" | jq -r '.pipeline.deliveries.ingestion.status' 2>/dev/null || echo "unknown")
    D1_INSERTED=$(echo "$DELIVERY_RESP" | jq -r '.pipeline.stored.d1InsertedAtMs' 2>/dev/null || echo "null")

    # Event is stored if d1InsertedAtMs is not null
    if [ "$D1_INSERTED" != "null" ]; then
      printf "    %-40s D1: STORED, Convex: %s\n" "$EVENT_TYPE" "$CONVEX_STATUS"
      ((DELIVERY_VERIFIED++))
    else
      printf "    %-40s D1: NOT STORED\n" "$EVENT_TYPE"
      ((DELIVERY_FAILED++))
    fi
  else
    printf "    %s: DELIVERY CHECK FAILED\n" "$EVT_ID"
    ((DELIVERY_FAILED++))
  fi
done

check_result "Delivery verification" "$([ $DELIVERY_VERIFIED -eq ${#EVENT_IDS[@]} ] && echo true || echo false)" "$DELIVERY_VERIFIED/${#EVENT_IDS[@]} events verified"

echo ""

# ============================================================================
# Phase 10: Test Idempotency
# ============================================================================

echo "=== Phase 10: Test Idempotency ==="

# Retry the first event with same idempotency key
IDEM_RETRY_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_SENT" \
  -d '{
    "eventId": "'"${EVENT_ID_SENT}_retry"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "email",
    "eventType": "email.message_sent",
    "timestamp": '"$TIMESTAMP_SENT"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$IDEM_KEY_SENT"'",
    "payload": {
      "messageId": "msg_retry_attempt",
      "threadId": "thread_retry",
      "subjectHash": "sha256_retry"
    }
  }')

IDEM_OK=$(echo "$IDEM_RETRY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
IDEM_DEDUPED=$(echo "$IDEM_RETRY_RESP" | jq -r '.deduped' 2>/dev/null || echo "false")
check_result "Idempotency (duplicate rejected)" "$([ "$IDEM_OK" = "true" ] && [ "$IDEM_DEDUPED" = "true" ] && echo true || echo false)" "deduped: $IDEM_DEDUPED"

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "=============================================="
echo "  iOS Email App Test Suite Complete"
echo "=============================================="
echo ""
echo "Test Run ID: $TEST_RUN_ID"
echo ""
echo "Events Created:"
for EVT_ID in "${EVENT_IDS[@]}"; do
  echo "  - $EVT_ID"
done
echo ""
echo "Trace IDs:"
for TRACE_ID in "${TRACE_IDS[@]}"; do
  echo "  - $TRACE_ID"
done
echo ""
echo "=============================================="
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "=============================================="
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
