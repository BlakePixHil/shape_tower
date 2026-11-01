# Play Games Services details for Shape Tower

Play Console > Grow users > Play Games Services > Setup and management > Configuration > Edit properties.

- **Display name:** Shape Tower
- **Description:** Stack wobbly, smiling shapes into a tower that never ends. Every piece has real physics, so one sloppy drop can tip the lot. Reach checkpoints, climb from the meadow through the clouds and out into space, and take on a new Daily Tower every day.
- **Category:** Puzzle
- **Icon (512 × 512):** icon-512.png (Art's app icon, brand.ts bakeAppIcon)
- **Feature graphic (1024 × 500):** feature-1024x500.png (Art's splash with two Blockling stacks)
- **Achievement icons:** the `play/` folder of /mnt/project-files/achievements/store-kit.zip, one 512 px PNG per achievement, named by its id.

Google's Play Games configuration API can't upload images or edit these details, so they go in by hand.
They're only needed to publish Play Games, which happens with the public launch. Testers can already use
the draft.

Regenerate the two images: `cd game && node /mnt/project-files/store/play-games/bake/bake.mjs <out dir>`
(copy entry.ts beside it in the out dir first).
