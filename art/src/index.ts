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
export { STAR_LAYERS, bakeStarTile, type StarLayer } from './stars.ts';
export { VFX, VFX_NAMES, bakeVfx, type VfxName } from './vfx.ts';
export { POWER, POWER_COLORS, POWER_ICON_NAMES, POWER_KINDS, bakeBubble, bakeBubbleGloss, bakePowerIcon, drawPowerIcon, powerBarCss, powerIconUrl, type PowerIcon, type PowerKind } from './powers.ts';
export { BUNTING_KEYS, CHECKPOINT, bakeFlag, bakeGlint, bakeGlowBand, bakeHoldTick, bakeLabel, bakePbDash, bakePbFlag, bakePennant, bakePlaque, bakeRopeTile } from './checkpoint.ts';
export { hexNum, labToHex, oklab } from './util.ts';

export { ArtTextures, type ArtTexturesOptions, type FacePart, type TexRef } from './phaser/textures.ts';
export { BlocklingView, type BlocklingOptions } from './phaser/blockling.ts';
export { GuideView, type GuideShow } from './phaser/guide.ts';
export { Backdrop, type BackdropOptions } from './phaser/backdrop.ts';
export { CheckpointLine, PbMarker, type CheckpointLayout } from './phaser/checkpoint.ts';
export { PowerBubble } from './phaser/power.ts';
export type { SceneLike } from './phaser/types.ts';
