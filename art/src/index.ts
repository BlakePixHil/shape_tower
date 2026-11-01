// Shape Tower art kit. Engine-free drawing (Canvas 2D) plus a thin Phaser 4 adapter.
// Every number comes from config.ts, which mirrors art-direction.md.

export * from './config.ts';
export { ART_SHAPES, BOULDER_DIAMETER, pose, type ArtShape, type Material, type Pose } from './shapes.ts';
export { faceAnchor, faceAt, outlineCorners, silhouette } from './geometry.ts';
export { EXPRESSIONS, FACE, PUPILS, drawFace, pupilTravel, type Expression } from './face.ts';
export { PIECE_PAD, bakeCells, bakePiece, bakeRim, bakeSilhouette, cellsPose, drawCells, drawPiece, type Baked, type Finish, type PieceStyle } from './piece.ts';
export { bakeBeamFill, bakeChevron, bakeContactDot, bakeContactRing, bakeGhostEdge, bakeGlyph, drawGlyph, edgeColor, type EdgeState, type GlyphState } from './guide.ts';
export { BIOMES, SkyClock, biomeForCheckpoint, presence, rimAmount, skyColors, starAmount, type Biome } from './biomes.ts';
export { SLAB_DEPTH, bakeGradeStamp, bakePedestal, bakeSlab, drawPedestal, drawSlab, pedestalHeight, type BakedSlab, type FoundationLook, type Grade } from './slab.ts';
export { bakeMeadow, type BackdropPart } from './meadow.ts';
export { bakeTreetops } from './treetops.ts';
export { bakeCloudlands, bakePunchThrough } from './cloudlands.ts';
export { bakeFlare, bakeRumble, bakeStorm, bakeStratosphere } from './storm.ts';
export { bakeDustDevil, bakeMoon, bakeOrbit, bakeRedPlanet, bakeRingArc, bakeRinged } from './space.ts';
export { COSMOS_PALETTES, LANDMARKS, bakeCosmos, bakeLandmark, type CosmosPalette, type Landmark, type LandmarkPose } from './cosmos.ts';
export { STAR_LAYERS, bakeStarTile, type StarLayer } from './stars.ts';
export { VFX, VFX_NAMES, bakeVfx, type VfxName } from './vfx.ts';
export { POP_POWER_ICONS, POWER, POWER_COLORS, POWER_ICON_NAMES, POWER_KINDS, bakeBubble, bakeBubbleGloss, bakePowerIcon, drawPowerIcon, powerBarCss, powerIconUrl, type PopPowerIcon, type PowerIcon, type PowerKind } from './powers.ts';
export { BUNTING_KEYS, CHECKPOINT, bakeFlag, bakeGlint, bakeGlowBand, bakeHoldTick, bakeLabel, bakePbDash, bakePbFlag, bakePennant, bakePlaque, bakeRopeTile } from './checkpoint.ts';
export { WIND, WIND_VARIANTS, bakeWind, windDrifters, type WindKind, type WindTex } from './wind.ts';
export { COLUMN_FRAMES, HAZARD, HAZARD_TEX, JUNK_KINDS, JUNK_LIGHT, bakeHazard, type HazardTex, type JunkKind } from './hazards.ts';
export { BALLOONS, CELEB, CELEB_TEX, bakeCelebration, type CelebTex } from './celebrate.ts';
export { bakeAppIcon, bakeShareCard, bakeSplash, type IconLayer, type ShareCardData } from './brand.ts';
export { bakePanorama, panoramaBiome, type PanoramaData, type TowerPiece, type TowerSlab } from './panorama.ts';
export { hexNum, labToHex, oklab, roman, turnCanvas, turnHex, variantTurn } from './util.ts';
export { BIOME_BAKERS, type BiomeBaker } from './backdrops.ts';

// Cosmetics (monetisation plan v2): the catalogue, and the skins, landing bursts, foundation styles and flags it draws.
export {
  COSMETICS, COSMETIC_SLOTS, DEFAULT_LOOK, PASS_EVERY, PASS_ITEMS, PASS_LAST_NEW, PASS_SLOT_ORDER, SLOT_NAMES, SUPPORTER_HAT, WORKSHOP_SETS,
  cosmetic, cosmeticVariant, flagFor, foundationFor, hatCosmeticId, hatFor, landingFor, passRewardAt, passRewardsBetween, skinFor, slotItems, variantId,
  type CosmeticDef, type CosmeticLook, type CosmeticSlot, type CosmeticSource, type WorkshopSet,
} from './cosmetics.ts';
export { drawSkin, skinColors, skinLook, type SkinInk, type SkinKind, type SkinLook } from './skins.ts';
export {
  LANDING_STYLES, LANDING_TEX, LANDING_TEX_NAMES, bakeLandingTex, drawLandingSprite, landingParticles, landingStyle,
  type LandingAt, type LandingKind, type LandingParticle, type LandingStyle, type LandingTex,
} from './landing.ts';
export { FOUNDATION_COLORS, drawFoundation, drawFoundationPedestal, foundationPad, type FoundationKind } from './foundations.ts';
export { FLAG_DESIGNS, drawStyledFlag, type FlagDesign, type FlagEmblem, type FlagKind, type FlagLook, type FlagPattern, type FlagShape } from './flags.ts';

// DOM UI kit (art-direction.md §8): CSS, icons, badges, logo, postcards and screen builders.
export { injectUiCss, uiCss } from './ui/css.ts';
export { UI_ICONS, bakeUiIcon, drawUiIcon, uiIconUrl, type UiIcon } from './ui/icons.ts';
export { BADGE_TIERS, TITLES, badgeFrame, badgeTier, badgeUrl, bakeBadge, drawBadge, newTitleAt, setBadgeFrame, titleFor, type BadgeFrame, type BadgeTier } from './ui/badge.ts';
export { LOGO_ROWS, bakeLogo, logoElement, logoPeekerUrl, logoTileUrl } from './ui/logo.ts';
export { bakePostcard, postcardElement, postcardUrl, type PostcardOptions } from './ui/postcard.ts';
export { RAIL_COLORS, altitudeRail, checkpointChip, offscreenChip, setOffscreenChip, setRail, type OffscreenChipOptions, type RailState } from './ui/rail.ts';
export { HAZARDS, hazardCard, hazardChip, hazardChipEnd, hazardChipGo, plumbBob, setPlumb, setWindsock, windsock, type HazardChipOptions, type HazardType } from './ui/hazard.ts';
export { biomeCard, type BiomeCardOptions } from './ui/biomecard.ts';
export { prewarmUi } from './ui/prewarm.ts';
export { bakeLookPreview, cosmeticUrl, drawCosmetic, lookPreviewUrl } from './ui/cosmeticArt.ts';
export {
  cosmeticLock, cosmeticOwned, injectLookCss, levelRewards, levelTrack, lookPanel, ownedLook, readLook, scrollTrackTo,
  type CosmeticLock, type CosmeticOwner, type LevelTrackData, type LookPanelData,
} from './ui/look.ts';
export { bagButton, bagLayerUrl, bagSwap, drawBag, setBag, type BagState } from './ui/bag.ts';
export {
  PORTRAIT_ART, bakePortrait, portraitElement, portraitHtml, portraitUrl, type PortraitArt, type PortraitId, type PortraitKind,
} from './ui/portraits.ts';
export { SHAPES_ALERT, SHAPES_LOW, alertEdge, setAlertEdge, setShapeCounter, shapeAlert, shapeCounter } from './ui/budget.ts';
export { warmUrls } from './urls.ts';
export {
  WORKSHOP_COPY, drawWorkshopArt, injectWorkshopCss, setWorkshopItem, setWorkshopNote, setWorkshopRestoring, setWorkshopStore, testPurchaseSheet, workshopArtUrl, workshopPanel,
  type WorkshopArt, type WorkshopData, type WorkshopItem, type WorkshopSection, type WorkshopState, type WorkshopStore,
} from './ui/workshop.ts';
export { ALL_HATS, HATS, drawHat, hatInfo, hatKey, hatUrl, hatVariant, type Hat, type HatInfo, type HatKey } from './ui/hats.ts';
export {
  armDailyScored, dailyCard, dailyChip, dailyMenuDot, setDailyCountdown, setDailyLadder, setDailyTab, type DailyCardData, type DailyResultData, type DailyTab,
} from './ui/daily.ts';
export {
  FORGET_LABEL, armForget, armReport, injectLadderCss, ladderHtml, nameCard, readNameCard, setNameBusy, setNameHint, type LadderPanelData, type LadderRowData, type NameCardData, type PortraitChoice,
} from './ui/ladder.ts';
export {
  ACH_TIERS, achievementBadgeUrl, achievementStrip, achievementToast, achievementsPanel, achievementsRow, bakeAchievementBadge, bakeAchievementForStore, drawAchievementBadge,
  type AchTier, type AchTierInfo, type AchievementBadge, type AchievementGroup, type AchievementItem, type AchievementStripItem, type AchievementToastData, type AchievementToastOptions,
} from './ui/achievements.ts';
export {
  AVATAR_FACES, AVATAR_SHAPES, MENU_MODES, PURCHASE_SETTINGS, SETTINGS_LAYOUT, UNLOCKS, avatarPanel, avatarUrl, drawAvatarFigure, levelUp, loadUiFonts, mainMenu, onAction, pauseCard, profilePanel,
  readAvatar, readSettings, rewardAt, setXpBar, settingsPanel, showAllXpLines, showXpLine, summaryCard, xpBar,
  type AvatarPanelData, type AvatarSpec, type LevelUpOptions, type MenuData, type MenuMode, type PauseOptions, type ProfileData, type ProfileStats,
  type SettingGroup, type SettingItem, type SettingValue, type SummaryData, type Unlock, type XpState,
} from './ui/screens.ts';


export { ArtTextures, type ArtTexturesOptions, type FacePart, type LandingSpawn, type TexRef } from './phaser/textures.ts';
export { BlocklingView, type BlocklingOptions } from './phaser/blockling.ts';
export { GuideView, type GuideShow } from './phaser/guide.ts';
export { Backdrop, type BackdropOptions } from './phaser/backdrop.ts';
export { CheckpointLine, PbMarker, type CheckpointLayout } from './phaser/checkpoint.ts';
export { PowerBubble } from './phaser/power.ts';
export { WindView, type Drifters, type WindDir, type WindOptions } from './phaser/wind.ts';
export { HazardFx, type HazardFxOptions } from './phaser/hazards.ts';
export { Celebration, FIREWORK_KINDS, type CelebrationOptions, type FireworkKind } from './phaser/celebrate.ts';
export type { SceneLike } from './phaser/types.ts';
