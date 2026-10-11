#!/usr/bin/env bash
# Keys stay in the process environment, never curl arguments or files.
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/ai-discovery.mjs" "${1:?new version required}" "${2:?previous version required}"
