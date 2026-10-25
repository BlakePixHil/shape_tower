# Marketing tools

Short clips for TikTok, YouTube Shorts and Instagram Reels, the Play store screenshots and promo
video, and the Play listing upload. Everything is made from the real game: a bot plays runs in Node,
the built app replays them step for step in headless Chromium, and every frame and sound comes from
the game itself. The launch plan these serve is the marketing plan doc (video and ASO sections).

```
cd marketing && npm install          # once (Playwright uses the machine's Chromium, see below)
node --experimental-strip-types scripts/weekly.ts          # next week's 7 clips
node --experimental-strip-types scripts/listing-shots.ts   # the 8 store screenshots
node --experimental-strip-types scripts/listing-shots.ts --appstore   # the same 8 at the App Store's iPhone size
node --experimental-strip-types scripts/promo.ts           # the 30 s promo video
node --experimental-strip-types scripts/play-listing.ts --dry   # check the listing upload, change nothing
npm run typecheck
```

Each script builds the phone app's page first (`npm run build:app` in `game/`); pass `--no-build`
to skip that when `game/dist-app/index.html` is current. Chromium comes from `/opt/pw-browsers/chromium`
(set `CHROMIUM` to use another), and ffmpeg must be on the path.

## What each part does

| File | Job |
| --- | --- |
| `src/bot.ts` | The clip bot: picks a column and turn for each shape like a player would (careful, sloppy or reckless), drags and turns at human speed, and uses its power-ups and Second Wind. |
| `src/runs.ts` | Plays a run in Node with the game's own sim (`game/src/sim`), logs the bot's inputs and the sim's digest every second, and finds the moments worth a clip: collapses, clutch saves, checkpoints (and near misses), perfect-drop combos, the Zen climb and the Daily. |
| `src/clock.js` | A virtual clock for the page: time only moves when the renderer says, so every frame is exactly 1/30 s apart however slow the machine is. CSS animations are frozen and stepped with it. |
| `src/driver.js` | The renderer's side of the page: a seasoned level-12 player (every first-time card, achievement and postcard already seen, so nothing covers a clip), starts the run through the real menu, feeds in the bot's inputs before the steps they were logged at, checks the digests, records every call the game makes to the audio director, and draws the captions and end card. |
| `src/render.ts` | Films one clip: fast-forwards (nothing drawn) to the moment, captures 1080 x 1920 frames, mixes the audio offline (`src/mix.ts`: Sound's director in an OfflineAudioContext, fed the same calls with 40 s of run-up), and encodes H.264 + AAC with ffmpeg. |
| `src/clips.ts` | Turns a moment into a clip: captions (burned in, since most people watch muted), how long it runs, and the post text and tags. |
| `scripts/weekly.ts` | A week of clips: 20 bot runs (18 Endless, the week's Daily, a Zen climb), the best moment of each format, one clip a day from Monday, `posts.md` and `plan.json`. Writes to `/mnt/project-files/marketing/clips/<monday>/`. |
| `scripts/listing-shots.ts` | The 8 store screenshots: run frames and app screens, framed on the brand's sky under a caption. `--candidates` saves every candidate frame to pick from. `--appstore` films the game at an iPhone's 430 x 932 points and frames it at 1290 x 2796 (the App Store's 6.9"/6.7" size), plus the unframed Workshop for Apple's in-app purchase review; copies live in `listing/app-store/` for the Mac that uploads them. |
| `scripts/promo.ts` | The promo video: six beats of play (a tower falling first) and the logo. |
| `listing/text.ts` | The store words for en-AU (default), en-GB and en-US, with Play's limits checked. |
| `scripts/play-listing.ts` | Uploads the words, icon, feature graphic and screenshots to Play in one edit. |

## Rules

- **Public words never name another company's game.** `src/clips.ts` `checkWords` and
  `listing/text.ts` `checkListing` refuse "Tetris" and "Jenga" in any caption, post or listing text.
- The Play service account key stays at `/mnt/project-files/android/play-service-account.json`.
  Never copy it into the repo, a log or a memory note. `src/play.ts` reads it from there.
- Play takes a listing video only as a YouTube link. Upload the promo to YouTube (unlisted is fine),
  then `scripts/play-listing.ts --video <link>`.
- Clips never show the run summary: when a screen opens, the end card takes over.
- A replay that drifts from the Node run (a digest mismatch or a missed input) is reported as a
  problem in the log and `plan.json`. None has happened so far, even over 70,000 steps.

## Timings (4 cores, no GPU)

A bot run takes about 4 s in Node (a 20 minute Zen climb about 22 s). In the browser, fast-forward
runs at about 450 steps a second, and each kept frame takes about 0.35 s to draw and capture. A
15 s clip takes 3 to 5 minutes; a week of 7 clips about 30 minutes.
