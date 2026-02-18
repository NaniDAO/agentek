#!/usr/bin/env bash
set -euo pipefail

# Release all @agentek packages in correct dependency order.
#
# ai-sdk and mcp use "workspace:^" for @agentek/tools, so pnpm
# automatically substitutes the real version on publish.
#
# Usage:
#   pnpm release              # patch bump (0.1.20 -> 0.1.21)
#   pnpm release minor        # minor bump (0.1.20 -> 0.2.0)
#   pnpm release major        # major bump (0.1.20 -> 1.0.0)
#   pnpm release 0.2.0        # explicit version

BUMP="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TOOLS_PKG="$ROOT/packages/shared/package.json"
AISDK_PKG="$ROOT/packages/ai-sdk/package.json"
MCP_PKG="$ROOT/packages/mcp/package.json"

# --- Helpers ---

get_version() { node -p "require('$1').version"; }

bump_version() {
  local current="$1" bump="$2"
  case "$bump" in
    patch) node -p "let [a,b,c]='$current'.split('.').map(Number);a+'.'+b+'.'+(c+1)" ;;
    minor) node -p "let [a,b]='$current'.split('.').map(Number);a+'.'+(b+1)+'.0'" ;;
    major) node -p "let [a]='$current'.split('.').map(Number);(a+1)+'.0.0'" ;;
    *)     echo "$bump" ;; # explicit version string
  esac
}

set_version() {
  local pkg="$1" ver="$2"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg','utf8'));
    p.version = '$ver';
    fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
}

# --- Compute new version ---

TOOLS_CUR=$(get_version "$TOOLS_PKG")
NEW_VER=$(bump_version "$TOOLS_CUR" "$BUMP")

echo "=== @agentek release ==="
echo "  Current @agentek/tools version: $TOOLS_CUR"
echo "  New version for all packages:   $NEW_VER"
echo ""

# --- Update versions ---

echo "Updating package versions..."
set_version "$TOOLS_PKG" "$NEW_VER"
set_version "$AISDK_PKG" "$NEW_VER"
set_version "$MCP_PKG" "$NEW_VER"

echo "  @agentek/tools     -> $NEW_VER"
echo "  @agentek/ai-sdk    -> $NEW_VER"
echo "  @agentek/mcp-server -> $NEW_VER"
echo ""

# --- Build all ---

echo "Building all packages..."
cd "$ROOT"
pnpm -r build
echo ""

# --- Publish in order (pnpm replaces workspace:^ with real version) ---

echo "Publishing @agentek/tools..."
cd "$ROOT/packages/shared"
pnpm publish --access public --no-git-checks
echo ""

echo "Publishing @agentek/ai-sdk..."
cd "$ROOT/packages/ai-sdk"
pnpm publish --access public --no-git-checks
echo ""

echo "Publishing @agentek/mcp-server..."
cd "$ROOT/packages/mcp"
pnpm publish --access public --no-git-checks
echo ""

echo "=== All packages published at v$NEW_VER ==="
