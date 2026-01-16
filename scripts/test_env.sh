#!/bin/bash
# Test environment setup script
# Sources test credentials for smoke and golden flow tests
#
# Usage: source ./scripts/test_env.sh

export CLERK_SECRET_KEY="sk_test_Bde9eYSTXQIJ5wahuQbFD8InA4k5hyzuyh544vezH2"
export TEST_USER_ID="user_38DtevN3dt5CtdJPZzYyXEQJoPu"
export GATEWAY_URL="${GATEWAY_URL:-http://localhost:8787}"
export ADMIN_API_KEY="dev-admin-key-12345"

# Function to get a fresh JWT (tokens expire in 60 seconds)
get_fresh_jwt() {
  local SESSION_ID="$1"

  # If no session ID provided, create a new session
  if [ -z "$SESSION_ID" ]; then
    SESSION_RESP=$(curl -s -X POST "https://api.clerk.com/v1/sessions" \
      -H "Authorization: Bearer $CLERK_SECRET_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"user_id\": \"$TEST_USER_ID\"}")
    SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.id // empty')
  fi

  # Get JWT from session
  TOKEN_RESP=$(curl -s -X POST "https://api.clerk.com/v1/sessions/$SESSION_ID/tokens" \
    -H "Authorization: Bearer $CLERK_SECRET_KEY" \
    -H "Content-Type: application/json")

  echo "$TOKEN_RESP" | jq -r '.jwt // empty'
}

# Export the function
export -f get_fresh_jwt

# Get initial JWT
echo "Fetching fresh JWT..."
export TEST_JWT=$(get_fresh_jwt)

if [ -n "$TEST_JWT" ]; then
  echo "Test environment configured:"
  echo "  GATEWAY_URL:   $GATEWAY_URL"
  echo "  TEST_USER_ID:  $TEST_USER_ID"
  echo "  ADMIN_API_KEY: ${ADMIN_API_KEY:0:10}..."
  echo "  TEST_JWT:      ${TEST_JWT:0:50}..."
  echo ""
  echo "Run tests with:"
  echo "  ./scripts/smoke_test.sh"
  echo "  ./scripts/golden_flow.sh"
else
  echo "ERROR: Failed to get JWT"
fi
