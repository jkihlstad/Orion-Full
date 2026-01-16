#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

log(){ echo "⏺ $*"; }
die(){ echo "✘ $*" >&2; exit 1; }

cd "$ROOT"

log "=== Deploying to PRODUCTION ==="
echo ""
echo "⚠️  This will deploy to PRODUCTION!"
echo ""

# Safety confirmation
if [[ "${FORCE:-}" != "1" ]]; then
  read -p "Type 'deploy' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "deploy" ]]; then
    die "Deployment cancelled"
  fi
fi

# Step 1: Verify staging was tested
log "[1/5] Pre-flight checks..."
if [[ "${SKIP_STAGING_CHECK:-}" != "1" ]]; then
  echo "  Ensure you have:"
  echo "    ✓ Deployed to staging"
  echo "    ✓ Run golden flow against staging"
  echo "    ✓ Verified no regressions"
  echo ""
  read -p "Have you completed all staging tests? (yes/no): " STAGING_OK
  if [[ "$STAGING_OK" != "yes" ]]; then
    die "Please complete staging tests first"
  fi
fi

# Step 2: Validate contracts
log "[2/5] Validating contracts..."
if [[ -f "../suite-contracts/tools/validate_contracts.py" ]]; then
  python3 ../suite-contracts/tools/validate_contracts.py
fi

# Step 3: Apply D1 migrations
log "[3/5] Applying D1 migrations to production..."
npx wrangler d1 migrations apply edge_gateway_prod

# Step 4: Deploy worker
log "[4/5] Deploying worker to production..."
npx wrangler deploy

# Step 5: Health check
log "[5/5] Running health check..."
sleep 3
HEALTH_URL="${PROD_GATEWAY_URL:-https://gateway.orion.app}/health"
if curl -sf "$HEALTH_URL" > /dev/null; then
  log "✓ Health check passed"
else
  die "Health check failed at $HEALTH_URL - ROLLBACK MAY BE NEEDED"
fi

echo ""
log "=== PRODUCTION DEPLOYMENT COMPLETE ✅ ==="
