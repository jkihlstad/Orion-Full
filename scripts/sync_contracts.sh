#!/bin/bash
#
# sync_contracts.sh
#
# Syncs suite-contracts schemas and mappings into src/contracts/.
# This script should be run whenever suite-contracts is updated.
#
# Usage:
#   ./scripts/sync_contracts.sh [path-to-suite-contracts]
#
# Examples:
#   ./scripts/sync_contracts.sh                           # Uses default ../suite-contracts
#   ./scripts/sync_contracts.sh /path/to/suite-contracts  # Uses custom path
#

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Path to suite-contracts (first argument or default)
SUITE_CONTRACTS_PATH="${1:-$PROJECT_ROOT/../suite-contracts}"

# Destination directories
CONTRACTS_DIR="$PROJECT_ROOT/src/contracts"
SCHEMAS_DIR="$CONTRACTS_DIR/schemas"
MAPPINGS_DIR="$CONTRACTS_DIR/mappings"

echo -e "${GREEN}=== Syncing suite-contracts ===${NC}"
echo "Source: $SUITE_CONTRACTS_PATH"
echo "Destination: $CONTRACTS_DIR"
echo ""

# Check if suite-contracts exists
if [ ! -d "$SUITE_CONTRACTS_PATH" ]; then
    echo -e "${RED}Error: suite-contracts not found at $SUITE_CONTRACTS_PATH${NC}"
    echo "Please provide the correct path as an argument:"
    echo "  ./scripts/sync_contracts.sh /path/to/suite-contracts"
    exit 1
fi

# Run export_contracts.sh in suite-contracts
echo -e "${YELLOW}Running export_contracts.sh in suite-contracts...${NC}"
EXPORT_SCRIPT="$SUITE_CONTRACTS_PATH/scripts/export_contracts.sh"
if [ ! -f "$EXPORT_SCRIPT" ]; then
    echo -e "${RED}Error: export_contracts.sh not found at $EXPORT_SCRIPT${NC}"
    exit 1
fi

if ! bash "$EXPORT_SCRIPT"; then
    echo -e "${RED}Error: export_contracts.sh failed${NC}"
    exit 1
fi
echo ""

# Verify dist directories exist after export
DIST_DIR="$SUITE_CONTRACTS_PATH/dist"
if [ ! -d "$DIST_DIR/schemas" ]; then
    echo -e "${RED}Error: dist/schemas not found after running export_contracts.sh${NC}"
    exit 1
fi

if [ ! -d "$DIST_DIR/mappings" ]; then
    echo -e "${RED}Error: dist/mappings not found after running export_contracts.sh${NC}"
    exit 1
fi

if [ ! -f "$DIST_DIR/manifest.json" ]; then
    echo -e "${RED}Error: dist/manifest.json not found after running export_contracts.sh${NC}"
    exit 1
fi

# Create destination directories
mkdir -p "$SCHEMAS_DIR"
mkdir -p "$MAPPINGS_DIR"

# Copy schemas
echo -e "${YELLOW}Copying schemas...${NC}"
rm -rf "$SCHEMAS_DIR"/*
cp -r "$DIST_DIR/schemas/"* "$SCHEMAS_DIR/"
SCHEMA_COUNT=$(find "$SCHEMAS_DIR" -type f -name "*.json" | wc -l | tr -d ' ')
echo "  - Copied $SCHEMA_COUNT schema files"

# Copy mappings
echo -e "${YELLOW}Copying mappings...${NC}"
rm -rf "$MAPPINGS_DIR"/*
cp -r "$DIST_DIR/mappings/"* "$MAPPINGS_DIR/"
MAPPING_COUNT=$(find "$MAPPINGS_DIR" -type f -name "*.json" | wc -l | tr -d ' ')
echo "  - Copied $MAPPING_COUNT mapping files"

# Copy manifest.json
echo -e "${YELLOW}Copying manifest.json...${NC}"
cp "$DIST_DIR/manifest.json" "$CONTRACTS_DIR/manifest.json"
echo "  - Copied manifest.json"

echo ""

# Verify checksums using manifest.json
echo -e "${YELLOW}Verifying checksums...${NC}"

# Read manifest and verify each file's checksum
CHECKSUM_FAILED=0

# Function to compute SHA256 checksum
compute_checksum() {
    if command -v sha256sum &> /dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &> /dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        echo -e "${RED}Error: No sha256sum or shasum command found${NC}"
        exit 1
    fi
}

# Parse manifest.json and verify checksums
# Expected manifest format: { "files": { "path": "checksum", ... } }
while IFS= read -r line; do
    # Extract path and expected checksum from JSON
    FILE_PATH=$(echo "$line" | sed -n 's/.*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    EXPECTED_CHECKSUM=$(echo "$line" | sed -n 's/.*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p')

    if [ -n "$FILE_PATH" ] && [ -n "$EXPECTED_CHECKSUM" ]; then
        # Determine full path based on file location
        if [[ "$FILE_PATH" == schemas/* ]]; then
            FULL_PATH="$CONTRACTS_DIR/$FILE_PATH"
        elif [[ "$FILE_PATH" == mappings/* ]]; then
            FULL_PATH="$CONTRACTS_DIR/$FILE_PATH"
        elif [[ "$FILE_PATH" == "manifest.json" ]]; then
            continue  # Skip manifest itself
        else
            continue
        fi

        if [ -f "$FULL_PATH" ]; then
            ACTUAL_CHECKSUM=$(compute_checksum "$FULL_PATH")
            if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
                echo -e "${RED}  - FAILED: $FILE_PATH${NC}"
                echo "    Expected: $EXPECTED_CHECKSUM"
                echo "    Actual:   $ACTUAL_CHECKSUM"
                CHECKSUM_FAILED=1
            fi
        else
            echo -e "${RED}  - MISSING: $FILE_PATH${NC}"
            CHECKSUM_FAILED=1
        fi
    fi
done < <(grep -E '^\s*"[^"]+"\s*:\s*"[a-f0-9]{64}"' "$CONTRACTS_DIR/manifest.json" 2>/dev/null || true)

if [ "$CHECKSUM_FAILED" -eq 1 ]; then
    echo ""
    echo -e "${RED}FAILED: Checksum verification failed!${NC}"
    echo "Some files do not match their expected checksums."
    exit 1
fi

echo -e "${GREEN}  - All checksums verified successfully${NC}"
echo ""
echo -e "${GREEN}SUCCESS: Contracts synced successfully!${NC}"
echo ""
echo "Summary:"
echo "  - Schemas: $SCHEMA_COUNT files"
echo "  - Mappings: $MAPPING_COUNT files"
echo "  - Manifest: verified"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff src/contracts/"
echo "  2. Test the build: npm run build"
echo "  3. Commit changes: git add src/contracts/ && git commit -m 'chore: sync suite-contracts'"
