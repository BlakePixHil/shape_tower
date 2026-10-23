// The store consoles' ids for the achievements (gameplay.md §18.5). `npm run stores:ids` writes the Play
// Games half from the console's export, together with the Android project id resource.

export const STORE_IDS = {
  /** Google Play Games: the game's project id and each achievement's id, both made by Play Console. Empty until then. */
  play: { projectId: '', achievements: {} as Record<string, string> },
  /**
   * Game Center: ids are ours to pick, so they are fixed now (prefix + the game's id) and must match App Store
   * Connect exactly. `enabled` once they exist there.
   */
  gameCenter: { enabled: false, prefix: 'shapetower.' },
};
