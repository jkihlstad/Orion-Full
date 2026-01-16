#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

log(){ echo "⏺ $*"; }
die(){ echo "✘ $*" >&2; exit 1; }

cd "$ROOT"

log "=== PRODUCTION ROLLBACK ==="
echo ""
echo "⚠️  This will rollback the production worker!"
echo ""

# Get deployments
log "Fetching recent deployments..."
npx wrangler deployments list | head -20

echo ""
read -p "Enter deployment ID to rollback to: " DEPLOYMENT_ID

if [[ -z "$DEPLOYMENT_ID" ]]; then
  die "No deployment ID provided"
fi

log "Rolling back to $DEPLOYMENT_ID..."
npx wrangler rollback "$DEPLOYMENT_ID"

log "=== ROLLBACK COMPLETE ==="
echo ""
echo "⚠️  D1 migrations cannot be automatically rolled back."
echo "    If you need to revert schema changes, apply a new migration."
