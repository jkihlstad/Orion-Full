#!/bin/bash
# Master iOS App Test Suite
# Tests all iOS apps: browser, dashboard, calendar, finance, email, tasks
#
# Usage: ./scripts/test_ios_all.sh [gateway_url]
#
# Environment variables:
#   GATEWAY_URL   - Base URL of the gateway (default: http://localhost:8787)
#   TEST_JWT      - Valid Clerk JWT for test user (required)
#   TEST_USER_ID  - User ID matching the JWT (required)
#   ADMIN_API_KEY - Admin API key for checking delivery status (required)

set -o pipefail

GATEWAY_URL="${1:-${GATEWAY_URL:-http://localhost:8787}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "  Orion iOS App Test Suite"
echo "============================================================"
echo "Gateway:  $GATEWAY_URL"
echo "Time:     $(date)"
echo ""

# Validate required env vars
if [ -z "$TEST_JWT" ]; then
  echo "ERROR: TEST_JWT environment variable is required"
  echo ""
  echo "To generate a test JWT, run:"
  echo "  source ./scripts/test_env.sh"
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

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_APPS=()

# Function to run a test script and capture results
run_test() {
  local name="$1"
  local script="$2"

  echo ""
  echo "============================================================"
  echo "  Testing: $name"
  echo "============================================================"

  if [ ! -f "$script" ]; then
    echo "ERROR: Test script not found: $script"
    ((TOTAL_FAIL++))
    FAILED_APPS+=("$name (script not found)")
    return 1
  fi

  chmod +x "$script"

  # Run the test and capture output
  OUTPUT=$("$script" 2>&1)
  EXIT_CODE=$?

  echo "$OUTPUT"

  # Parse results from output
  PASSED=$(echo "$OUTPUT" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || echo "0")
  FAILED=$(echo "$OUTPUT" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+' || echo "0")

  TOTAL_PASS=$((TOTAL_PASS + PASSED))
  TOTAL_FAIL=$((TOTAL_FAIL + FAILED))

  if [ "$EXIT_CODE" -ne 0 ] || [ "$FAILED" -gt 0 ]; then
    FAILED_APPS+=("$name")
  fi

  return $EXIT_CODE
}

# Run all test suites
echo ""
echo "Starting iOS app tests..."
echo ""

# Test each iOS app
run_test "ios-browser" "$SCRIPT_DIR/test_ios_browser.sh"
run_test "ios-dashboard" "$SCRIPT_DIR/test_ios_dashboard.sh"
run_test "ios-calendar" "$SCRIPT_DIR/test_ios_calendar.sh"
run_test "ios-finance" "$SCRIPT_DIR/test_ios_finance.sh"
run_test "ios-email" "$SCRIPT_DIR/test_ios_email.sh"
run_test "ios-tasks" "$SCRIPT_DIR/test_ios_tasks.sh"

# Summary
echo ""
echo "============================================================"
echo "  iOS App Test Suite Summary"
echo "============================================================"
echo ""
echo "Total Results: $TOTAL_PASS passed, $TOTAL_FAIL failed"
echo ""

if [ ${#FAILED_APPS[@]} -gt 0 ]; then
  echo "Failed apps:"
  for app in "${FAILED_APPS[@]}"; do
    echo "  - $app"
  done
  echo ""
fi

if [ $TOTAL_FAIL -eq 0 ]; then
  echo "SUCCESS: All iOS app tests passed!"
  exit 0
else
  echo "FAILURE: Some tests failed. See above for details."
  exit 1
fi
