#!/bin/bash
# QA's merge gate: every module's own checks plus QA's fast set, on one checkout of the repo
# (a PR head, a trial merge, or main after a merge). There is no CI, so this is what "the tests
# pass" means before a thread merges.
# Usage: qa/scripts/gate.sh [checkout]   (default: this repo)
# QA_FONTS=<dir> serves Fredoka and Nunito from a local fonts.css and its .woff2 files to the UI
# screen check, for machines whose headless browser can't reach Google Fonts.
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
  # Achievement rules, the Daily Tower's days, seeds, attempts and shape sets, and the ladder's name filter,
  # in Node (#37, #60, #68).
  for c in achievements:check daily:check names:check; do
    grep -q "\"$c\"" "$R/game/package.json" && run "game: ${c/:/ }" bash -c "cd game && npm run -s $c"
  done
  run "game: build" bash -c 'cd game && npm run -s build'
  if grep -q '"build:game"' "$R/game/package.json"; then
    run "game: build game page" bash -c 'cd game && npm run -s build:game'
    # The built game played headless through every screen, its power-ups from the HUD, a run down to
    # its last shapes (the shapes-left warnings, #51), the level-up celebration with its avatar picker,
    # a Zen run through pause, Finish, the summary and back to Endless (#57), the achievements' toast,
    # strip, tally and panel (#37), the Daily Tower's card, attempts and played day (#60), the loading
    # splash (#61), a checkpoint hold's grey, knock freeze and colour overshoot (#62), and the Daily ladder
    # against the ladder API run in memory on this machine, never the live one (#68).
    for t in game-check power-check budget-check avatar-check zen-check achievements-browser daily-check splash-check hold-check ladder-check; do
      [ -f "$R/game/tests/$t.mjs" ] && run "game: $t" bash -c "cd game && node tests/$t.mjs"
    done
  fi
fi
if [ -d "$R/art" ]; then
  run "art: npm ci" bash -c 'cd art && npm ci --no-audit --no-fund'
  run "art: typecheck" bash -c 'cd art && npm run -s typecheck'
  run "art: build" bash -c 'cd art && npm run -s build'
  # Every UI kit screen at three sizes: tap targets, overflow, cut-off text, page errors.
  [ -f "$R/qa/scripts/ui-screens.mjs" ] && run "art: UI screens" node qa/scripts/ui-screens.mjs art/dist/index.html qa/reports/ui-screens "${QA_FONTS:-}"
fi
if [ -d "$R/audio" ]; then
  run "audio: npm ci" bash -c 'cd audio && npm ci --no-audit --no-fund'
  run "audio: test" bash -c 'cd audio && npm test'
fi
# The Daily ladder's API (#68): its handler's rules against an in-memory store.
if [ -d "$R/online" ]; then
  run "online: npm ci" bash -c 'cd online && npm ci --no-audit --no-fund'
  run "online: typecheck" bash -c 'cd online && npm run -s typecheck'
  run "online: api check" bash -c 'cd online && npm run -s api:check'
fi
# The ladder server as Cloudflare runs it, from the repo root: wrangler dev (workerd with the Durable Object's
# SQLite) answering the selftest and the game's calls, and keeping the ladder across a restart (#71).
if [ -f "$R/package.json" ] && grep -q '"ladder:check"' "$R/package.json"; then
  run "root: npm ci" npm ci --no-audit --no-fund
  run "root: ladder check" npm run -s ladder:check
fi
if [ -d "$R/qa" ]; then
  run "qa: npm ci" bash -c 'cd qa && npm ci --no-audit --no-fund --legacy-peer-deps'
  run "qa: typecheck" bash -c 'cd qa && npm run -s typecheck'
  run "qa: fast set" bash -c "cd qa && QA_GAME_SIM=$R/game/src/sim/testApi.ts npx vitest run"
fi
rm -f "$log"
exit $status
