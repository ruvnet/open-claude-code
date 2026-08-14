#!/bin/bash
set -euo pipefail

echo "=== Harness Initialization ==="

node scripts/harness/validate-state.mjs
node scripts/harness/validate-policy.mjs
node scripts/harness/secret-scan.mjs

echo "=== v2 static compile check ==="
while IFS= read -r -d '' source_file; do
  node --check "$source_file"
done < <(find v2/src -type f -name '*.mjs' -print0)

echo "=== v2 package tests ==="
if command -v npm.cmd >/dev/null 2>&1; then
  npm_command="npm.cmd"
else
  npm_command="npm"
fi

(
  cd v2
  "$npm_command" test
)

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on"
echo "3. Implement only that feature"
echo "4. Re-run verification before claiming done"
