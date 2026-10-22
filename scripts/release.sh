#!/usr/bin/env bash
set -euo pipefail

# Preview by default. Preparation updates manifests; publishing is a separate step.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/release.mjs" "$@"
