import type { TerrainMeta } from "./types";

/** Grille d'altitudes : logique pure, sans rendu. */
export class Terrain {
  constructor(
    readonly meta: TerrainMeta,
    /** Altitudes en mètres, ligne 0 = nord. */
    readonly heights: Float32Array,
  ) {
    if (heights.length !== meta.cols * meta.rows) throw new Error("terrain : taille de grille incohérente");
  }

  /** Décode le fichier terrain.bin (uint16 little-endian, centimètres au-dessus de `base`). */
  static decode(meta: TerrainMeta, bin: ArrayBuffer): Terrain {
    const raw = new Uint16Array(bin);
    const heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) heights[i] = meta.base + (raw[i] ?? 0) * meta.unit;
    return new Terrain(meta, heights);
  }

  get xMin(): number {
    return this.meta.x0;
  }
  get xMax(): number {
    return this.meta.x0 + this.meta.cols * this.meta.res;
  }
  get yMin(): number {
    return this.meta.y1 - this.meta.rows * this.meta.res;
  }
  get yMax(): number {
    return this.meta.y1;
  }

  private at(col: number, row: number): number {
    const c = Math.min(Math.max(col, 0), this.meta.cols - 1);
    const r = Math.min(Math.max(row, 0), this.meta.rows - 1);
    return this.heights[r * this.meta.cols + c] ?? 0;
  }

  /** Altitude (interpolation bilinéaire) ; au-delà des bords, la valeur du bord. */
  heightAt(x: number, y: number): number {
    const { x0, y1, res } = this.meta;
    const fx = (x - x0) / res - 0.5;
    const fy = (y1 - y) / res - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;
    const top = this.at(c0, r0) * (1 - tx) + this.at(c0 + 1, r0) * tx;
    const bottom = this.at(c0, r0 + 1) * (1 - tx) + this.at(c0 + 1, r0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}
