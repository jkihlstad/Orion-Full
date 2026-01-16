#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

log(){ echo "⏺ $*"; }
die(){ echo "✘ $*" >&2; exit 1; }

cd "$ROOT"

log "=== Deploying to STAGING ==="
echo ""

# Step 1: Validate contracts
log "[1/4] Validating contracts..."
if [[ -f "../suite-contracts/tools/validate_contracts.py" ]]; then
  python3 ../suite-contracts/tools/validate_contracts.py
elif [[ -f "../../suite-contracts/tools/validate_contracts.py" ]]; then
  python3 ../../suite-contracts/tools/validate_contracts.py
else
  log "⚠️  Cannot find validate_contracts.py, skipping validation"
fi

# Step 2: Apply D1 migrations
log "[2/4] Applying D1 migrations to staging..."
npx wrangler d1 migrations apply edge_gateway_staging --env staging

# Step 3: Deploy worker
log "[3/4] Deploying worker to staging..."
npx wrangler deploy --env staging

# Step 4: Health check
log "[4/4] Running health check..."
sleep 2
HEALTH_URL="${STAGING_GATEWAY_URL:-https://gateway-staging.orion.app}/health"
if curl -sf "$HEALTH_URL" > /dev/null; then
  log "✓ Health check passed"
else
  die "Health check failed at $HEALTH_URL"
fi

echo ""
log "=== STAGING DEPLOYMENT COMPLETE ✅ ==="
echo ""
echo "Next steps:"
echo "  1. Run golden flow: ENV_FILE=env/staging.env ./scripts/golden_flow.sh"
echo "  2. If all tests pass, run: ./scripts/deploy_prod.sh"
