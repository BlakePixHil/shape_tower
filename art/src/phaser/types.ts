// The slice of Phaser 4 the adapter uses, as structural types. art/ never imports Phaser, so it has
// no dependency of its own and can't pull in a second copy; pass your Phaser.Scene and it fits.

/** What every displayed object here supports. */
export interface DisplayLike {
  x: number;
  y: number;
  alpha: number;
  visible: boolean;
  width: number;
  height: number;
  setPosition(x: number, y?: number): this;
  setOrigin(x?: number, y?: number): this;
  setScale(x: number, y?: number): this;
  setRotation(radians?: number): this;
  setAlpha(value?: number): this;
  setVisible(value: boolean): this;
  setDepth(value: number): this;
  setTexture(key: string, frame?: string | number): this;
  setTint(color: number): this;
  clearTint(): this;
  setScrollFactor(x: number, y?: number): this;
  setDisplaySize(width: number, height: number): this;
  destroy(): void;
}

export interface ImageLike extends DisplayLike {
  setCrop(x?: number, y?: number, width?: number, height?: number): this;
}

export interface TileSpriteLike extends DisplayLike {
  tilePositionX: number;
  tilePositionY: number;
  setSize(width: number, height: number): this;
}

export interface CanvasTextureLike {
  refresh(): unknown;
  add(name: string, sourceIndex: number, x: number, y: number, width: number, height: number): unknown;
}

export interface CameraLike {
  width: number;
  height: number;
  zoom: number;
}

export interface SceneLike {
  add: {
    image(x: number, y: number, key: string, frame?: string | number): ImageLike;
    tileSprite(x: number, y: number, width: number, height: number, key: string): TileSpriteLike;
  };
  textures: {
    exists(key: string): boolean;
    addCanvas(key: string, source: HTMLCanvasElement): CanvasTextureLike | null;
    remove(key: string): unknown;
  };
  cameras: { main: CameraLike };
}
