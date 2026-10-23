# Game services plugin

The game's achievements on Google Play Games (Android) and Game Center (iOS), gameplay.md §18.5. It's a local
Capacitor plugin (`"@shape-tower/game-services": "file:plugins/game-services"`), so `npx cap sync` wires it into
each native project like any other. `src/meta/stores.ts` drives it; the game page never loads it.

The device stays the source of truth. The plugin only passes unlocks and progress on while the player is signed
in. It never prompts on its own: both services sign returning players in at launch, and `signIn()` runs only from
the Achievements panel's "Open in …" button.

| Method | Play Games | Game Center |
| --- | --- | --- |
| `status()` | `available` once the project id is set and Play services are on the phone | always `available` |
| `signIn()` | Play Games' sign-in | the sign-in sheet Game Center handed over at launch |
| `unlock({ id })` | `AchievementsClient.unlock` | `GKAchievement` at 100 % |
| `progress({ id, steps, total })` | `setSteps` (incremental achievements) | percent of `total` |
| `show()` | Play Games' achievements screen | `GKGameCenterViewController(state: .achievements)` |
| `signInChanged` event | after a sign-in, or a sign-out from Play Games' own screen | whenever Game Center's sign-in changes |

## Turning it on

- **Play Games:** with the Play service account key, `npm run stores:play -- <project id> --apply` makes the
  achievements in Play Console through Google's Publishing API (icons still go in by hand) and writes their ids.
  Or, for achievements made by hand, `npm run stores:ids -- games-ids.xml` reads the file Play Console exports
  (Play Games Services > Achievements > Get resources). Both write the ids into `src/meta/store-ids.ts` and the
  project id into `android/app/src/main/res/values/game_services.xml`. Until then the project id is empty, Play
  Games is never started (its auto-start provider is removed from the manifest) and the button doesn't show.
- **Game Center:** the ids are ours (`shapetower.<id>`), so nothing to import. Create them in App Store Connect
  with the kit (`npm run store-kit`), then set `gameCenter.enabled` in `store-ids.ts` (or pass `--gamecenter` to
  `stores:ids`). The iOS app target also needs the Game Center capability (entitlement
  `com.apple.developer.game-center`).

The Swift side is built only on a Mac (Xcode); it has not been compiled here.
