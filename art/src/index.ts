// Shape Tower art kit. Engine-free drawing (Canvas 2D) plus a thin Phaser 4 adapter.
// Every number comes from config.ts, which mirrors art-direction.md.

export * from './config.ts';
export { ART_SHAPES, BOULDER_DIAMETER, pose, type ArtShape, type Material, type Pose } from './shapes.ts';
export { faceAnchor, faceAt, outlineCorners, silhouette } from './geometry.ts';
export { EXPRESSIONS, FACE, PUPILS, drawFace, pupilTravel, type Expression } from './face.ts';
export { PIECE_PAD, bakePiece, bakeRim, bakeSilhouette, drawPiece, type Baked, type Finish, type PieceStyle } from './piece.ts';
export { bakeBeamFill, bakeChevron, bakeContactDot, bakeContactRing, bakeGhostEdge, bakeGlyph, drawGlyph, edgeColor, type EdgeState, type GlyphState } from './guide.ts';
export { BIOMES, SkyClock, biomeForCheckpoint, presence, rimAmount, skyColors, starAmount, type Biome } from './biomes.ts';
export { SLAB_DEPTH, bakeGradeStamp, bakePedestal, bakeSlab, drawPedestal, drawSlab, pedestalHeight, type BakedSlab, type Grade } from './slab.ts';
export { bakeMeadow, type BackdropPart } from './meadow.ts';
export { bakeTreetops } from './treetops.ts';
export { bakeCloudlands, bakePunchThrough } from './cloudlands.ts';
export { bakeFlare, bakeRumble, bakeStorm, bakeStratosphere } from './storm.ts';
export { bakeDustDevil, bakeMoon, bakeOrbit, bakeRedPlanet, bakeRingArc, bakeRinged } from './space.ts';
export { COSMOS_PALETTES, LANDMARKS, bakeCosmos, bakeLandmark, type CosmosPalette, type Landmark, type LandmarkPose } from './cosmos.ts';
export { STAR_LAYERS, bakeStarTile, type StarLayer } from './stars.ts';
export { VFX, VFX_NAMES, bakeVfx, type VfxName } from './vfx.ts';
export { POWER, POWER_COLORS, POWER_ICON_NAMES, POWER_KINDS, bakeBubble, bakeBubbleGloss, bakePowerIcon, drawPowerIcon, powerBarCss, powerIconUrl, type PowerIcon, type PowerKind } from './powers.ts';
export { BUNTING_KEYS, CHECKPOINT, bakeFlag, bakeGlint, bakeGlowBand, bakeHoldTick, bakeLabel, bakePbDash, bakePbFlag, bakePennant, bakePlaque, bakeRopeTile } from './checkpoint.ts';
export { WIND, WIND_VARIANTS, bakeWind, windDrifters, type WindKind, type WindTex } from './wind.ts';
export { hexNum, labToHex, oklab } from './util.ts';
export { BIOME_BAKERS, type BiomeBaker } from './backdrops.ts';

// DOM UI kit (art-direction.md §8): CSS, icons, badges, logo, postcards and screen builders.
export { injectUiCss, uiCss } from './ui/css.ts';
export { UI_ICONS, bakeUiIcon, drawUiIcon, uiIconUrl, type UiIcon } from './ui/icons.ts';
export { BADGE_TIERS, TITLES, badgeTier, badgeUrl, bakeBadge, drawBadge, newTitleAt, titleFor, type BadgeTier } from './ui/badge.ts';
export { LOGO_ROWS, bakeLogo, logoElement, logoPeekerUrl, logoTileUrl } from './ui/logo.ts';
export { bakePostcard, postcardElement, postcardUrl, type PostcardOptions } from './ui/postcard.ts';
export { HAZARDS, hazardCard, hazardChip, hazardChipEnd, hazardChipGo, type HazardChipOptions, type HazardType } from './ui/hazard.ts';
export {
  MENU_MODES, SETTINGS_LAYOUT, UNLOCKS, avatarUrl, levelUp, loadUiFonts, mainMenu, onAction, pauseCard, profilePanel, readSettings,
  rewardAt, setXpBar, settingsPanel, showAllXpLines, showXpLine, summaryCard, xpBar,
  type AvatarSpec, type LevelUpOptions, type MenuData, type MenuMode, type PauseOptions, type ProfileData, type ProfileStats,
  type SettingGroup, type SettingItem, type SettingValue, type SummaryData, type Unlock, type XpState,
} from './ui/screens.ts';


export { ArtTextures, type ArtTexturesOptions, type FacePart, type TexRef } from './phaser/textures.ts';
export { BlocklingView, type BlocklingOptions } from './phaser/blockling.ts';
export { GuideView, type GuideShow } from './phaser/guide.ts';
export { Backdrop, type BackdropOptions } from './phaser/backdrop.ts';
export { CheckpointLine, PbMarker, type CheckpointLayout } from './phaser/checkpoint.ts';
export { PowerBubble } from './phaser/power.ts';
export { WindView, type Drifters, type WindDir, type WindOptions } from './phaser/wind.ts';
export type { SceneLike } from './phaser/types.ts';
