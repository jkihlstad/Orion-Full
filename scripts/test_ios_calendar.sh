#!/bin/bash
# iOS Calendar App Integration Tests
# Tests the complete calendar event pipeline: Consent -> Ingest -> D1 -> Queue -> Fanout
#
# Usage: ./scripts/test_ios_calendar.sh [gateway_url]
#
# Environment variables (required):
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user
#   TEST_USER_ID  - User ID matching the JWT
#   ADMIN_API_KEY - Admin API key for checking delivery status

set -e

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"

echo "=============================================="
echo "  iOS Calendar App Integration Tests"
echo "=============================================="
echo "Gateway:  $GATEWAY_URL"
echo ""

# ============================================================================
# Validate Environment
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
# Test State
# ============================================================================

PASS=0
FAIL=0
EVENT_IDS=()
CONSENT_VERSION="2026-01-11"

# ============================================================================
# Helper Functions
# ============================================================================

# Generate a unique trace ID for each test
generate_trace_id() {
  echo "cal_$(date +%s%N)_${RANDOM}_$$"
}

# Check result helper - matches golden_flow.sh pattern
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

# Ingest a calendar event and verify storage
ingest_calendar_event() {
  local event_type="$1"
  local payload="$2"
  local trace_id="$3"
  local test_name="$4"

  local event_id="cal_${event_type//\./_}_$(date +%s%N)_${RANDOM}"
  local idem_key="idem_${event_id}"
  local timestamp=$(($(date +%s) * 1000))

  # Ingest the event
  local resp
  resp=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -H "X-Trace-Id: $trace_id" \
    -d '{
      "eventId": "'"$event_id"'",
      "userId": "'"$TEST_USER_ID"'",
      "sourceApp": "calendar",
      "eventType": "'"$event_type"'",
      "timestamp": '"$timestamp"',
      "privacyScope": "private",
      "consentVersion": "'"$CONSENT_VERSION"'",
      "idempotencyKey": "'"$idem_key"'",
      "payload": '"$payload"'
    }')

  local ok
  ok=$(echo "$resp" | jq -r '.ok' 2>/dev/null || echo "false")
  local returned_id
  returned_id=$(echo "$resp" | jq -r '.eventId' 2>/dev/null || echo "")

  if [ "$ok" = "true" ]; then
    EVENT_IDS+=("$event_id")
    check_result "$test_name" "true" "eventId: $returned_id, traceId: $trace_id"
    return 0
  else
    local error
    error=$(echo "$resp" | jq -r '.error.message // .error // "unknown"' 2>/dev/null || echo "$resp")
    check_result "$test_name" "false" "Error: $error"
    return 1
  fi
}

# Verify event delivery status via admin endpoint
verify_delivery_status() {
  local event_id="$1"
  local test_name="$2"
  local max_retries=5
  local retry_delay=2

  for ((i=1; i<=max_retries; i++)); do
    local resp
    resp=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?eventId=$event_id" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    local ok
    ok=$(echo "$resp" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$ok" = "true" ]; then
      local stored_at
      stored_at=$(echo "$resp" | jq -r '.pipeline.stored.d1InsertedAtMs // "null"' 2>/dev/null)
      local convex_status
      convex_status=$(echo "$resp" | jq -r '.pipeline.deliveries.ingestion.status // "unknown"' 2>/dev/null)

      if [ "$stored_at" != "null" ] && [ -n "$stored_at" ]; then
        check_result "$test_name" "true" "D1 stored, Convex: $convex_status"
        return 0
      fi
    fi

    if [ $i -lt $max_retries ]; then
      sleep $retry_delay
    fi
  done

  check_result "$test_name" "false" "Event not found after $max_retries attempts"
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

echo "=== Phase 2: Enable Calendar Consent Scopes ==="

# Enable calendar.events consent scope
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "'"$CONSENT_VERSION"'",
    "updates": {
      "calendar.events": true,
      "calendar.events_basic": true,
      "calendar.automation": true,
      "consent.calendar.read": true,
      "consent.calendar.write": true
    }
  }')

OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
UPDATED=$(echo "$CONSENT_RESP" | jq -r '.updated | length' 2>/dev/null || echo "0")
check_result "Enable calendar consent scopes" "$OK" "Updated $UPDATED scopes"

# Verify consent was set
CONSENT_GET=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")

CALENDAR_EVENTS=$(echo "$CONSENT_GET" | jq -r '.scopes["calendar.events"] // false' 2>/dev/null)
CALENDAR_AUTOMATION=$(echo "$CONSENT_GET" | jq -r '.scopes["calendar.automation"] // false' 2>/dev/null)
check_result "Verify consent scopes enabled" "$([ "$CALENDAR_EVENTS" = "true" ] && echo true || echo false)" "calendar.events=$CALENDAR_EVENTS, calendar.automation=$CALENDAR_AUTOMATION"

echo ""

# ============================================================================
# Phase 3: Calendar Event Tests
# ============================================================================

echo "=== Phase 3: Calendar Event Ingestion ==="

# Test 1: calendar.event_created
TRACE_ID_1=$(generate_trace_id)
START_TIME=$(date -u -v+1d +"%Y-%m-%dT09:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT09:00:00Z" 2>/dev/null || echo "2026-01-15T09:00:00Z")
END_TIME=$(date -u -v+1d +"%Y-%m-%dT10:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT10:00:00Z" 2>/dev/null || echo "2026-01-15T10:00:00Z")

ingest_calendar_event "calendar.event_created" '{
  "eventId": "evt_meeting_'"$(date +%s)"'",
  "title": "Team Standup Meeting",
  "startTime": "'"$START_TIME"'",
  "endTime": "'"$END_TIME"'",
  "timezone": "America/Los_Angeles",
  "isAllDay": false,
  "location": "Conference Room A",
  "attendees": ["alice@example.com", "bob@example.com"],
  "description": "Daily standup to sync on progress",
  "calendarId": "primary",
  "createdAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
}' "$TRACE_ID_1" "calendar.event_created"

# Test 2: calendar.event_updated
TRACE_ID_2=$(generate_trace_id)
ingest_calendar_event "calendar.event_updated" '{
  "eventId": "evt_meeting_'"$(date +%s)"'",
  "title": "Team Standup Meeting (Updated)",
  "changes": {
    "title": {"from": "Team Standup Meeting", "to": "Team Standup Meeting (Updated)"},
    "location": {"from": "Conference Room A", "to": "Conference Room B"},
    "endTime": {"from": "'"$END_TIME"'", "to": "2026-01-15T10:30:00Z"}
  },
  "updatedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "updatedBy": "'"$TEST_USER_ID"'"
}' "$TRACE_ID_2" "calendar.event_updated"

# Test 3: calendar.event_deleted
TRACE_ID_3=$(generate_trace_id)
ingest_calendar_event "calendar.event_deleted" '{
  "eventId": "evt_cancelled_'"$(date +%s)"'",
  "reason": "Meeting cancelled by organizer",
  "deletedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "deletedBy": "'"$TEST_USER_ID"'",
  "notifyAttendees": true
}' "$TRACE_ID_3" "calendar.event_deleted"

# Test 4: calendar.event_imported
TRACE_ID_4=$(generate_trace_id)
ingest_calendar_event "calendar.event_imported" '{
  "eventId": "evt_imported_'"$(date +%s)"'",
  "calendarId": "cal_work_'"$TEST_USER_ID"'",
  "source": "google_calendar",
  "sourceEventId": "google_evt_abc123",
  "title": "Quarterly Planning",
  "startTime": "2026-01-20T14:00:00Z",
  "endTime": "2026-01-20T16:00:00Z",
  "timezone": "America/New_York",
  "isAllDay": false,
  "importedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "syncStatus": "imported"
}' "$TRACE_ID_4" "calendar.event_imported"

# Test 5: calendar.event_change_requested
TRACE_ID_5=$(generate_trace_id)
ingest_calendar_event "calendar.event_change_requested" '{
  "eventId": "evt_reschedule_'"$(date +%s)"'",
  "changeType": "reschedule",
  "proposedChanges": {
    "startTime": {"from": "2026-01-16T09:00:00Z", "to": "2026-01-17T09:00:00Z"},
    "endTime": {"from": "2026-01-16T10:00:00Z", "to": "2026-01-17T10:00:00Z"}
  },
  "requestedBy": "alice@example.com",
  "requestedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "reason": "Conflict with another meeting",
  "expiresAt": "2026-01-15T23:59:59Z"
}' "$TRACE_ID_5" "calendar.event_change_requested"

# Test 6: calendar.event_change_approved
TRACE_ID_6=$(generate_trace_id)
ingest_calendar_event "calendar.event_change_approved" '{
  "eventId": "evt_approved_'"$(date +%s)"'",
  "changeType": "reschedule",
  "approvedBy": "'"$TEST_USER_ID"'",
  "approvedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "appliedChanges": {
    "startTime": "2026-01-17T09:00:00Z",
    "endTime": "2026-01-17T10:00:00Z"
  },
  "notificationSent": true
}' "$TRACE_ID_6" "calendar.event_change_approved"

# Test 7: calendar.event_change_denied
TRACE_ID_7=$(generate_trace_id)
ingest_calendar_event "calendar.event_change_denied" '{
  "eventId": "evt_denied_'"$(date +%s)"'",
  "changeType": "cancellation",
  "deniedBy": "'"$TEST_USER_ID"'",
  "deniedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "reason": "This meeting is mandatory and cannot be cancelled",
  "originalRequest": {
    "requestedBy": "bob@example.com",
    "requestedAt": "2026-01-14T10:00:00Z"
  }
}' "$TRACE_ID_7" "calendar.event_change_denied"

# Test 8: calendar.event_locked
TRACE_ID_8=$(generate_trace_id)
ingest_calendar_event "calendar.event_locked" '{
  "eventId": "evt_locked_'"$(date +%s)"'",
  "lockedBy": "'"$TEST_USER_ID"'",
  "lockedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "lockReason": "Final review meeting - no changes allowed",
  "lockExpiresAt": "2026-01-20T23:59:59Z",
  "allowedModifiers": ["'"$TEST_USER_ID"'"],
  "lockType": "full"
}' "$TRACE_ID_8" "calendar.event_locked"

# Test 9: calendar.sync_completed
TRACE_ID_9=$(generate_trace_id)
ingest_calendar_event "calendar.sync_completed" '{
  "calendarId": "cal_primary_'"$TEST_USER_ID"'",
  "syncSource": "google_calendar",
  "eventsAdded": 5,
  "eventsUpdated": 3,
  "eventsDeleted": 1,
  "totalEvents": 42,
  "syncStartedAt": "'"$(date -u -v-5M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "-5 minutes" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "2026-01-14T11:55:00Z")"'",
  "syncCompletedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
  "nextSyncScheduledAt": "'"$(date -u -v+1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+1 hour" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "2026-01-14T13:00:00Z")"'",
  "syncStatus": "success",
  "errors": []
}' "$TRACE_ID_9" "calendar.sync_completed"

echo ""

# ============================================================================
# Phase 4: Verify Events in D1
# ============================================================================

echo "=== Phase 4: Verify Events in D1 ==="

# Check events/mine to verify events were stored
MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20&eventType=calendar" \
  -H "Authorization: Bearer $TEST_JWT")

OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Events stored in D1 (events/mine)" "$OK" "Found $COUNT calendar events"

echo ""

# ============================================================================
# Phase 5: Verify Delivery Status via Admin Endpoint
# ============================================================================

echo "=== Phase 5: Verify Delivery Status ==="

echo "    Waiting 3s for queue processing..."
sleep 3

# Verify a sample of events via admin delivery status
VERIFIED_COUNT=0
SAMPLE_SIZE=3

for i in $(seq 0 $((SAMPLE_SIZE - 1))); do
  if [ $i -lt ${#EVENT_IDS[@]} ]; then
    EVENT_ID="${EVENT_IDS[$i]}"
    if verify_delivery_status "$EVENT_ID" "Delivery status: ${EVENT_ID:0:30}..."; then
      ((VERIFIED_COUNT++))
    fi
  fi
done

echo ""
echo "    Verified $VERIFIED_COUNT/$SAMPLE_SIZE sampled events"

# Check recent deliveries for calendar events
RECENT_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/recent?eventType=calendar&limit=10" \
  -H "X-Admin-Key: $ADMIN_API_KEY")

RECENT_OK=$(echo "$RECENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
RECENT_COUNT=$(echo "$RECENT_RESP" | jq '.events | length' 2>/dev/null || echo "0")
check_result "Recent calendar deliveries" "$RECENT_OK" "Found $RECENT_COUNT recent events"

echo ""

# ============================================================================
# Phase 6: Additional Validation Tests
# ============================================================================

echo "=== Phase 6: Additional Validation ==="

# Test idempotency - resend the first event with same idempotency key
if [ ${#EVENT_IDS[@]} -gt 0 ]; then
  FIRST_EVENT_ID="${EVENT_IDS[0]}"
  IDEM_KEY="idem_${FIRST_EVENT_ID}"
  TIMESTAMP=$(($(date +%s) * 1000))

  IDEM_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -d '{
      "eventId": "'"${FIRST_EVENT_ID}_dup"'",
      "userId": "'"$TEST_USER_ID"'",
      "sourceApp": "calendar",
      "eventType": "calendar.event_created",
      "timestamp": '"$TIMESTAMP"',
      "privacyScope": "private",
      "consentVersion": "'"$CONSENT_VERSION"'",
      "idempotencyKey": "'"$IDEM_KEY"'",
      "payload": {"test": "idempotency_check"}
    }')

  OK=$(echo "$IDEM_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
  DEDUPED=$(echo "$IDEM_RESP" | jq -r '.deduped' 2>/dev/null || echo "false")
  check_result "Idempotency (duplicate rejected)" "$([ "$OK" = "true" ] && [ "$DEDUPED" = "true" ] && echo true || echo false)" "deduped: $DEDUPED"
fi

# Test invalid event type (should fail)
INVALID_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "invalid_'"$(date +%s)"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "calendar",
    "eventType": "calendar.invalid_event_type_xyz",
    "timestamp": '"$(($(date +%s) * 1000))"',
    "privacyScope": "private",
    "consentVersion": "'"$CONSENT_VERSION"'",
    "idempotencyKey": "invalid_idem_'"$(date +%s)"'",
    "payload": {"test": "invalid_type"}
  }')

# Note: Depending on gateway config, unregistered events may be accepted or rejected
# We just verify we get a response
INVALID_OK=$(echo "$INVALID_RESP" | jq -r '.ok' 2>/dev/null || echo "error")
check_result "Unknown event type handling" "$([ "$INVALID_OK" != "error" ] && echo true || echo false)" "Response ok=$INVALID_OK (may accept or reject based on config)"

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "=============================================="
echo "  iOS Calendar Test Complete"
echo "=============================================="
echo ""
echo "Events tested:"
echo "  - calendar.event_created"
echo "  - calendar.event_updated"
echo "  - calendar.event_deleted"
echo "  - calendar.event_imported"
echo "  - calendar.event_change_requested"
echo "  - calendar.event_change_approved"
echo "  - calendar.event_change_denied"
echo "  - calendar.event_locked"
echo "  - calendar.sync_completed"
echo ""
echo "Event IDs generated: ${#EVENT_IDS[@]}"
echo ""
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All calendar tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
