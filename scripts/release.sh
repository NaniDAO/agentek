#!/usr/bin/env bash
set -euo pipefail

# Release all @agentek packages in correct dependency order.
#
# Uses the highest version across all 3 packages as the base,
# so no package ever gets a version downgrade.
#
# ai-sdk and mcp use "workspace:^" for @agentek/tools, so pnpm
# automatically substitutes the real version on publish.
#
# Usage:
#   pnpm release              # patch bump
#   pnpm release minor        # minor bump
#   pnpm release major        # major bump
#   pnpm release 0.2.0        # explicit version

BUMP="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TOOLS_PKG="$ROOT/packages/shared/package.json"
AISDK_PKG="$ROOT/packages/ai-sdk/package.json"
MCP_PKG="$ROOT/packages/mcp/package.json"

# --- Helpers ---

get_version() { node -p "require('$1').version"; }

max_version() {
  node -p "
    const versions = process.argv.slice(1);
    versions.sort((a, b) => {
      const [a1,a2,a3] = a.split('.').map(Number);
      const [b1,b2,b3] = b.split('.').map(Number);
      return a1 - b1 || a2 - b2 || a3 - b3;
    });
    versions[versions.length - 1];
  " "$@"
}

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

# --- Compute new version from highest current ---

V_TOOLS=$(get_version "$TOOLS_PKG")
V_AISDK=$(get_version "$AISDK_PKG")
V_MCP=$(get_version "$MCP_PKG")

HIGHEST=$(max_version "$V_TOOLS" "$V_AISDK" "$V_MCP")
NEW_VER=$(bump_version "$HIGHEST" "$BUMP")

echo "=== @agentek release ==="
echo "  @agentek/tools      current: $V_TOOLS"
echo "  @agentek/ai-sdk     current: $V_AISDK"
echo "  @agentek/mcp-server current: $V_MCP"
echo "  Highest: $HIGHEST -> New: $NEW_VER"
echo ""

# --- Update all to same version ---

echo "Setting all packages to $NEW_VER..."
set_version "$TOOLS_PKG" "$NEW_VER"
set_version "$AISDK_PKG" "$NEW_VER"
set_version "$MCP_PKG" "$NEW_VER"
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
