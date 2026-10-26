import { describe, expect, it } from "vitest";
import { Terrain } from "./terrain";
import type { TerrainMeta } from "./types";

const meta: TerrainMeta = { cols: 3, rows: 2, res: 2, x0: -3, y0: -2, y1: 2, base: -10, unit: 0.01, zmin: -10, zmax: -8 };

describe("Terrain", () => {
  it("décode les centimètres au-dessus de la base", () => {
    const bin = new Uint16Array([0, 100, 200, 0, 100, 200]).buffer;
    const t = Terrain.decode(meta, bin);
    expect(t.heights[1]).toBeCloseTo(-9);
    expect(t.heights[2]).toBeCloseTo(-8);
  });

  it("interpole entre les centres de cellules", () => {
    const t = Terrain.decode(meta, new Uint16Array([0, 100, 200, 0, 100, 200]).buffer);
    // Centre de la cellule (col 0) : x = -3 + 1 = -2 ; centre de (col 1) : x = 0.
    expect(t.heightAt(-2, 1)).toBeCloseTo(-10);
    expect(t.heightAt(0, 1)).toBeCloseTo(-9);
    expect(t.heightAt(-1, 1)).toBeCloseTo(-9.5);
  });

  it("garde la valeur du bord hors de la grille", () => {
    const t = Terrain.decode(meta, new Uint16Array([0, 100, 200, 0, 100, 200]).buffer);
    expect(t.heightAt(-100, 0)).toBeCloseTo(-10);
    expect(t.heightAt(100, 0)).toBeCloseTo(-8);
  });

  it("annonce ses bords", () => {
    const t = Terrain.decode(meta, new Uint16Array(6).buffer);
    expect([t.xMin, t.xMax, t.yMin, t.yMax]).toEqual([-3, 3, -2, 2]);
  });

  it("refuse une grille de mauvaise taille", () => {
    expect(() => new Terrain(meta, new Float32Array(5))).toThrow();
  });
});
