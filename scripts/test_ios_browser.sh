#!/bin/bash
# iOS Browser App Test Script for Edge Gateway
# Tests browser events with realistic payloads: page_viewed, session_started, dwell_time,
# link_clicked, tab_opened, tab_closed, scroll_depth, search_performed
#
# Usage: ./scripts/test_ios_browser.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (optional)

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"

echo "=============================================="
echo "  iOS Browser App Test Suite"
echo "=============================================="
echo "Gateway:  $GATEWAY_URL"
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
TRACE_IDS=()

# Helper function - matches pattern from golden_flow.sh
check_result() {
  local name="$1"
  local condition="$2"
  local details="$3"

  printf "%-45s " "$name..."
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

# Generate unique trace ID for a test
generate_trace_id() {
  local test_name="$1"
  echo "ios_browser_${test_name}_$(date +%s)_$$_$RANDOM"
}

# Generate unique event ID
generate_event_id() {
  local test_name="$1"
  echo "browser_${test_name}_$(date +%s)_$$_$RANDOM"
}

# Generate SHA256 hash (simulating iOS client hashing)
generate_hash() {
  local input="$1"
  echo -n "$input" | shasum -a 256 | cut -d' ' -f1 | head -c 16
}

echo "=== Phase 1: Health Check ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
check_result "Gateway health" "$([ "$STATUS" = "200" ] && echo true || echo false)" "HTTP $STATUS"

echo ""
echo "=== Phase 2: Consent Setup ==="
echo "    Enabling browser consent scopes..."

# Enable required consent scopes for browser events
# Based on registry.json:
# - browser.activity_basic: page_viewed, session_started, tab_opened, tab_closed, search_performed
# - browser.activity_detailed: dwell_time, link_clicked, scroll_depth
# - browser.content_capture: screenshot_uploaded (not tested here but enabled for completeness)
CONSENT_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/consent/update" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "consentVersion": "2026-01-11",
    "updates": {
      "browser.activity_basic": true,
      "browser.activity_detailed": true,
      "browser.content_capture": true
    }
  }')
OK=$(echo "$CONSENT_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "Enable browser consent scopes" "$OK" "browser.activity_basic, browser.activity_detailed, browser.content_capture"

# Verify consent was set
CONSENT_GET_RESP=$(curl -s "$GATEWAY_URL/v1/consent/get" \
  -H "Authorization: Bearer $TEST_JWT")
BASIC_ENABLED=$(echo "$CONSENT_GET_RESP" | jq -r '.scopes["browser.activity_basic"]' 2>/dev/null || echo "false")
DETAILED_ENABLED=$(echo "$CONSENT_GET_RESP" | jq -r '.scopes["browser.activity_detailed"]' 2>/dev/null || echo "false")
check_result "Verify consent persisted" "$([ "$BASIC_ENABLED" = "true" ] && [ "$DETAILED_ENABLED" = "true" ] && echo true || echo false)" "basic=$BASIC_ENABLED, detailed=$DETAILED_ENABLED"

echo ""
echo "=== Phase 3: Browser Event Tests ==="

# -------------------------------------------------------------------------
# Test 1: browser.session_started
# -------------------------------------------------------------------------
echo ""
echo "--- Test 1: browser.session_started ---"
TRACE_ID_1=$(generate_trace_id "session_started")
EVENT_ID_1=$(generate_event_id "session_started")
SESSION_ID="session_$(date +%s)_$RANDOM"
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_1" \
  -d '{
    "eventId": "'"$EVENT_ID_1"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.session_started",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_1"'_idem",
    "payload": {
      "sessionId": "'"$SESSION_ID"'",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OrionBrowser/1.0",
      "deviceType": "iphone",
      "osVersion": "17.0",
      "appVersion": "1.0.0",
      "screenWidth": 390,
      "screenHeight": 844
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.session_started ingest" "$OK" "eventId: $EVENT_ID_1, sessionId: $SESSION_ID"
EVENT_IDS+=("$EVENT_ID_1")
TRACE_IDS+=("$TRACE_ID_1")

# -------------------------------------------------------------------------
# Test 2: browser.page_viewed
# -------------------------------------------------------------------------
echo ""
echo "--- Test 2: browser.page_viewed ---"
TRACE_ID_2=$(generate_trace_id "page_viewed")
EVENT_ID_2=$(generate_event_id "page_viewed")
TAB_ID="tab_$(date +%s)_$RANDOM"
PATH_HASH=$(generate_hash "/articles/technology/ai-news")
TITLE_HASH=$(generate_hash "Latest AI News - Tech Daily")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_2" \
  -d '{
    "eventId": "'"$EVENT_ID_2"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.page_viewed",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_2"'_idem",
    "payload": {
      "host": "techdaily.com",
      "pathHash": "'"$PATH_HASH"'",
      "titleHash": "'"$TITLE_HASH"'",
      "viewDurationMs": 45000,
      "tabId": "'"$TAB_ID"'",
      "sessionId": "'"$SESSION_ID"'",
      "referrerHost": "google.com",
      "isSecure": true
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.page_viewed ingest" "$OK" "eventId: $EVENT_ID_2, host: techdaily.com"
EVENT_IDS+=("$EVENT_ID_2")
TRACE_IDS+=("$TRACE_ID_2")

# -------------------------------------------------------------------------
# Test 3: browser.dwell_time
# -------------------------------------------------------------------------
echo ""
echo "--- Test 3: browser.dwell_time ---"
TRACE_ID_3=$(generate_trace_id "dwell_time")
EVENT_ID_3=$(generate_event_id "dwell_time")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_3" \
  -d '{
    "eventId": "'"$EVENT_ID_3"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.dwell_time",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_3"'_idem",
    "payload": {
      "host": "techdaily.com",
      "dwellMs": 120000,
      "scrollDepthPercent": 75,
      "tabId": "'"$TAB_ID"'",
      "sessionId": "'"$SESSION_ID"'",
      "interactionCount": 12,
      "focusTimeMs": 95000
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.dwell_time ingest" "$OK" "eventId: $EVENT_ID_3, dwellMs: 120000"
EVENT_IDS+=("$EVENT_ID_3")
TRACE_IDS+=("$TRACE_ID_3")

# -------------------------------------------------------------------------
# Test 4: browser.link_clicked
# -------------------------------------------------------------------------
echo ""
echo "--- Test 4: browser.link_clicked ---"
TRACE_ID_4=$(generate_trace_id "link_clicked")
EVENT_ID_4=$(generate_event_id "link_clicked")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_4" \
  -d '{
    "eventId": "'"$EVENT_ID_4"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.link_clicked",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_4"'_idem",
    "payload": {
      "host": "techdaily.com",
      "linkHost": "github.com",
      "transitionType": "link",
      "tabId": "'"$TAB_ID"'",
      "sessionId": "'"$SESSION_ID"'",
      "cssSelectorHash": "'"$(generate_hash "article.main a.external-link")"'",
      "isNewTab": true
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.link_clicked ingest" "$OK" "eventId: $EVENT_ID_4, linkHost: github.com"
EVENT_IDS+=("$EVENT_ID_4")
TRACE_IDS+=("$TRACE_ID_4")

# -------------------------------------------------------------------------
# Test 5: browser.tab_opened
# -------------------------------------------------------------------------
echo ""
echo "--- Test 5: browser.tab_opened ---"
TRACE_ID_5=$(generate_trace_id "tab_opened")
EVENT_ID_5=$(generate_event_id "tab_opened")
NEW_TAB_ID="tab_$(date +%s)_$RANDOM"
WINDOW_ID="window_main_1"
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_5" \
  -d '{
    "eventId": "'"$EVENT_ID_5"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.tab_opened",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_5"'_idem",
    "payload": {
      "tabId": "'"$NEW_TAB_ID"'",
      "windowId": "'"$WINDOW_ID"'",
      "isNewTab": true,
      "sessionId": "'"$SESSION_ID"'",
      "sourceTabId": "'"$TAB_ID"'",
      "openedVia": "link_click",
      "tabIndex": 2
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.tab_opened ingest" "$OK" "eventId: $EVENT_ID_5, tabId: $NEW_TAB_ID"
EVENT_IDS+=("$EVENT_ID_5")
TRACE_IDS+=("$TRACE_ID_5")

# -------------------------------------------------------------------------
# Test 6: browser.tab_closed
# -------------------------------------------------------------------------
echo ""
echo "--- Test 6: browser.tab_closed ---"
TRACE_ID_6=$(generate_trace_id "tab_closed")
EVENT_ID_6=$(generate_event_id "tab_closed")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_6" \
  -d '{
    "eventId": "'"$EVENT_ID_6"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.tab_closed",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_6"'_idem",
    "payload": {
      "tabId": "'"$NEW_TAB_ID"'",
      "windowId": "'"$WINDOW_ID"'",
      "sessionDurationMs": 180000,
      "sessionId": "'"$SESSION_ID"'",
      "pagesViewed": 3,
      "closedVia": "user_action"
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.tab_closed ingest" "$OK" "eventId: $EVENT_ID_6, sessionDurationMs: 180000"
EVENT_IDS+=("$EVENT_ID_6")
TRACE_IDS+=("$TRACE_ID_6")

# -------------------------------------------------------------------------
# Test 7: browser.scroll_depth
# -------------------------------------------------------------------------
echo ""
echo "--- Test 7: browser.scroll_depth ---"
TRACE_ID_7=$(generate_trace_id "scroll_depth")
EVENT_ID_7=$(generate_event_id "scroll_depth")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_7" \
  -d '{
    "eventId": "'"$EVENT_ID_7"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.scroll_depth",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_7"'_idem",
    "payload": {
      "host": "techdaily.com",
      "maxDepthPercent": 92,
      "totalScrollDistance": 4500,
      "tabId": "'"$TAB_ID"'",
      "sessionId": "'"$SESSION_ID"'",
      "scrollEvents": 45,
      "timeToMaxDepthMs": 60000
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.scroll_depth ingest" "$OK" "eventId: $EVENT_ID_7, maxDepthPercent: 92"
EVENT_IDS+=("$EVENT_ID_7")
TRACE_IDS+=("$TRACE_ID_7")

# -------------------------------------------------------------------------
# Test 8: browser.search_performed
# -------------------------------------------------------------------------
echo ""
echo "--- Test 8: browser.search_performed ---"
TRACE_ID_8=$(generate_trace_id "search_performed")
EVENT_ID_8=$(generate_event_id "search_performed")
QUERY_HASH=$(generate_hash "best restaurants near me")
TIMESTAMP=$(($(date +%s) * 1000))

RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingest" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $TRACE_ID_8" \
  -d '{
    "eventId": "'"$EVENT_ID_8"'",
    "userId": "'"$TEST_USER_ID"'",
    "sourceApp": "browser",
    "eventType": "browser.search_performed",
    "timestamp": '"$TIMESTAMP"',
    "privacyScope": "private",
    "consentVersion": "2026-01-11",
    "idempotencyKey": "'"$EVENT_ID_8"'_idem",
    "payload": {
      "searchEngine": "google",
      "queryHash": "'"$QUERY_HASH"'",
      "resultCount": 25,
      "tabId": "'"$TAB_ID"'",
      "sessionId": "'"$SESSION_ID"'",
      "searchType": "web",
      "queryWordCount": 4
    }
  }')

OK=$(echo "$RESP" | jq -r '.ok' 2>/dev/null || echo "false")
check_result "browser.search_performed ingest" "$OK" "eventId: $EVENT_ID_8, searchEngine: google"
EVENT_IDS+=("$EVENT_ID_8")
TRACE_IDS+=("$TRACE_ID_8")

echo ""
echo "=== Phase 4: Verify Events in D1 ==="

# Wait briefly for events to be stored
sleep 1

# Check events/mine to verify events were stored
MINE_RESP=$(curl -s "$GATEWAY_URL/v1/events/mine?limit=20&sourceApp=ios-browser" \
  -H "Authorization: Bearer $TEST_JWT")

OK=$(echo "$MINE_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
COUNT=$(echo "$MINE_RESP" | jq '.items | length' 2>/dev/null || echo "0")
check_result "Events stored in D1" "$OK" "found $COUNT events from ios-browser"

# Verify specific event types are present
PAGE_VIEWED_COUNT=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "browser.page_viewed")] | length' 2>/dev/null || echo "0")
check_result "browser.page_viewed in D1" "$([ "$PAGE_VIEWED_COUNT" -ge 1 ] && echo true || echo false)" "count: $PAGE_VIEWED_COUNT"

SESSION_STARTED_COUNT=$(echo "$MINE_RESP" | jq '[.items[] | select(.eventType == "browser.session_started")] | length' 2>/dev/null || echo "0")
check_result "browser.session_started in D1" "$([ "$SESSION_STARTED_COUNT" -ge 1 ] && echo true || echo false)" "count: $SESSION_STARTED_COUNT"

echo ""
echo "=== Phase 5: Delivery Status Check (Admin) ==="

if [ -n "$ADMIN_API_KEY" ]; then
  echo "    Waiting 3s for queue processing..."
  sleep 3

  DELIVERY_OK=0
  DELIVERY_FAIL=0

  for i in "${!TRACE_IDS[@]}"; do
    TRACE_ID="${TRACE_IDS[$i]}"
    EVENT_ID="${EVENT_IDS[$i]}"

    DELIVERY_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?traceId=$TRACE_ID" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    RESP_OK=$(echo "$DELIVERY_RESP" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$RESP_OK" = "true" ]; then
      EVENT_COUNT=$(echo "$DELIVERY_RESP" | jq '.events | length' 2>/dev/null || echo "0")
      if [ "$EVENT_COUNT" -ge 1 ]; then
        ((DELIVERY_OK++))
      else
        ((DELIVERY_FAIL++))
      fi
    else
      ((DELIVERY_FAIL++))
    fi
  done

  check_result "Delivery status verified" "$([ "$DELIVERY_FAIL" -eq 0 ] && echo true || echo false)" "$DELIVERY_OK/$((DELIVERY_OK + DELIVERY_FAIL)) events tracked"

  # Sample detailed check for the first trace ID
  if [ ${#TRACE_IDS[@]} -gt 0 ]; then
    FIRST_TRACE="${TRACE_IDS[0]}"
    SAMPLE_RESP=$(curl -s "$GATEWAY_URL/v1/admin/delivery/status?traceId=$FIRST_TRACE" \
      -H "X-Admin-Key: $ADMIN_API_KEY")

    CONVEX_DELIVERED=$(echo "$SAMPLE_RESP" | jq '[.events[] | select(.convexDeliveredAt != null)] | length' 2>/dev/null || echo "0")
    TOTAL_EVENTS=$(echo "$SAMPLE_RESP" | jq '.events | length' 2>/dev/null || echo "0")
    echo "    Sample delivery (trace: ${FIRST_TRACE:0:30}...): Convex $CONVEX_DELIVERED/$TOTAL_EVENTS"
  fi
else
  echo "    Skipping (no ADMIN_API_KEY provided)"
fi

echo ""
echo "=== Phase 6: Batch Ingest Test ==="

# Test batch ingest with multiple browser events
BATCH_TRACE_ID=$(generate_trace_id "batch")
BATCH_EVENT_1=$(generate_event_id "batch1")
BATCH_EVENT_2=$(generate_event_id "batch2")
BATCH_EVENT_3=$(generate_event_id "batch3")
TIMESTAMP_BASE=$(($(date +%s) * 1000))

BATCH_RESP=$(curl -s -X POST "$GATEWAY_URL/v1/events/ingestBatch" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Trace-Id: $BATCH_TRACE_ID" \
  -d '{
    "events": [
      {
        "eventId": "'"$BATCH_EVENT_1"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "browser",
        "eventType": "browser.page_viewed",
        "timestamp": '"$TIMESTAMP_BASE"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "'"$BATCH_EVENT_1"'_idem",
        "payload": {
          "host": "news.ycombinator.com",
          "pathHash": "'"$(generate_hash "/news")"'",
          "titleHash": "'"$(generate_hash "Hacker News")"'",
          "viewDurationMs": 30000,
          "tabId": "'"$TAB_ID"'"
        }
      },
      {
        "eventId": "'"$BATCH_EVENT_2"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "browser",
        "eventType": "browser.scroll_depth",
        "timestamp": '"$((TIMESTAMP_BASE + 1000))"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "'"$BATCH_EVENT_2"'_idem",
        "payload": {
          "host": "news.ycombinator.com",
          "maxDepthPercent": 100,
          "totalScrollDistance": 8000,
          "tabId": "'"$TAB_ID"'"
        }
      },
      {
        "eventId": "'"$BATCH_EVENT_3"'",
        "userId": "'"$TEST_USER_ID"'",
        "sourceApp": "browser",
        "eventType": "browser.link_clicked",
        "timestamp": '"$((TIMESTAMP_BASE + 2000))"',
        "privacyScope": "private",
        "consentVersion": "2026-01-11",
        "idempotencyKey": "'"$BATCH_EVENT_3"'_idem",
        "payload": {
          "host": "news.ycombinator.com",
          "linkHost": "github.com",
          "transitionType": "link",
          "tabId": "'"$TAB_ID"'"
        }
      }
    ]
  }')

BATCH_OK=$(echo "$BATCH_RESP" | jq -r '.ok' 2>/dev/null || echo "false")
ACCEPTED=$(echo "$BATCH_RESP" | jq -r '.accepted' 2>/dev/null || echo "0")
check_result "Batch ingest (3 browser events)" "$([ "$BATCH_OK" = "true" ] && [ "$ACCEPTED" = "3" ] && echo true || echo false)" "accepted: $ACCEPTED/3"

echo ""
echo "=============================================="
echo "  iOS Browser App Test Suite Complete"
echo "=============================================="
echo ""
echo "Session ID: $SESSION_ID"
echo "Events tested: ${#EVENT_IDS[@]} individual + 3 batch"
echo ""
echo "Event IDs:"
for eid in "${EVENT_IDS[@]}"; do
  echo "  - $eid"
done
echo ""
echo "Trace IDs:"
for tid in "${TRACE_IDS[@]}"; do
  echo "  - ${tid:0:50}..."
done
echo ""
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "SUCCESS: All iOS Browser tests passed!"
  exit 0
else
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
