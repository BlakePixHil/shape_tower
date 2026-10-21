#!/bin/bash
# QA's merge gate: every module's own checks plus QA's fast set, on one checkout of the repo
# (a PR head, a trial merge, or main after a merge). There is no CI, so this is what "the tests
# pass" means before a thread merges.
# Usage: qa/scripts/gate.sh [checkout]   (default: this repo)
R=$(cd "${1:-$(dirname "$0")/../..}" && pwd) || exit 2
log=$(mktemp)
status=0
run() {
  local name=$1; shift
  local t0=$(date +%s)
  if (cd "$R" && "$@") > "$log" 2>&1; then echo "PASS $name ($(( $(date +%s) - t0 )) s)"
  else echo "FAIL $name ($(( $(date +%s) - t0 )) s)"; tail -25 "$log" | sed 's/^/    /'; status=1; fi
}
if [ -d "$R/game" ]; then
  run "game: npm ci" bash -c 'cd game && npm ci --no-audit --no-fund'
  run "game: typecheck" bash -c 'cd game && npm run -s typecheck'
  run "game: sim smoke" bash -c 'cd game && npm run -s sim:smoke'
  run "game: gesture check" bash -c 'cd game && npm run -s gesture:check'
  run "game: build" bash -c 'cd game && npm run -s build'
fi
if [ -d "$R/art" ]; then
  run "art: npm ci" bash -c 'cd art && npm ci --no-audit --no-fund'
  run "art: typecheck" bash -c 'cd art && npm run -s typecheck'
fi
if [ -d "$R/audio" ]; then
  run "audio: npm ci" bash -c 'cd audio && npm ci --no-audit --no-fund'
  run "audio: test" bash -c 'cd audio && npm test'
fi
if [ -d "$R/qa" ]; then
  run "qa: npm ci" bash -c 'cd qa && npm ci --no-audit --no-fund --legacy-peer-deps'
  run "qa: typecheck" bash -c 'cd qa && npm run -s typecheck'
  run "qa: fast set" bash -c "cd qa && QA_GAME_SIM=$R/game/src/sim/testApi.ts npx vitest run"
fi
rm -f "$log"
exit $status
