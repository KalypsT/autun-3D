import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { Terrain, TiledTerrain } from "./terrain";
import type { TerrainMeta, WorldManifest } from "./types";

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

/** Deux tuiles de 10 m côte à côte (x de 0 à 20), relief grossier plat à 0, blocs fins en pente. */
function twoTiles(): { manifest: WorldManifest; terrain: TiledTerrain } {
  const tile = (col: number) => ({ id: `${col}_0`, col, row: 0, bounds: [col * 10, 0, col * 10 + 10, 10] as [number, number, number, number], buildings: 0, trees: 0, walls: 0, furniture: 0, lod: 0, bytes: 0 });
  const coarse: TerrainMeta = { cols: 5, rows: 3, res: 8, x0: -10, y0: -7, y1: 17, base: 0, unit: 0.01, zmin: 0, zmax: 0 };
  const manifest = {
    origin: [0, 0], originZ: 0, tileSize: 10, cols: 2, rows: 1, gridOrigin: [0, 0], zone: [0, 0, 20, 10], tiles: [tile(0), tile(1)], lattice: [0, 0], blockSize: 14, coarse,
    super: { tiles: 4, res: 4, size: 252, cells: [] },
  } as WorldManifest;
  return { manifest, terrain: new TiledTerrain(manifest, Terrain.decode(coarse, new Uint16Array(15).buffer), () => Promise.reject(new Error("hors ligne"))) };
}

/** Bloc fin d'une tuile de 10 m : côté 14, de x0 - 2 à x0 + 12, altitude = 0,1 × x. */
function block(x0: number): ArrayBuffer {
  const n = 14, buf = new ArrayBuffer(16 + n * n * 2);
  new Float32Array(buf, 0, 4).set([0, x0 - 2, 12, n]);
  const raw = new Uint16Array(buf, 16, n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) raw[r * n + c] = Math.round((x0 - 2 + c + 0.5) * 0.1 * 100) + 1000;
  return buf;
}

describe("TiledTerrain", () => {
  it("retombe sur le relief grossier tant que le bloc fin n'est pas là", () => {
    const { terrain } = twoTiles();
    expect(terrain.has("0_0")).toBe(false);
    expect(terrain.heightAt(5, 5)).toBeCloseTo(0);
  });

  it("utilise le bloc fin de la tuile quand il est chargé, sans couture entre deux tuiles", () => {
    const { terrain } = twoTiles();
    terrain.setBlock("0_0", TiledTerrain.decodeBlock(block(0)));
    terrain.setBlock("1_0", TiledTerrain.decodeBlock(block(10)));
    expect(terrain.heightAt(3, 5)).toBeCloseTo(10 + 0.3, 2);
    expect(terrain.heightAt(14, 5)).toBeCloseTo(10 + 1.4, 2);
    // Les deux côtés de la frontière x = 10 donnent la même pente continue.
    expect(terrain.heightAt(10 - 1e-6, 4)).toBeCloseTo(terrain.heightAt(10 + 1e-6, 4), 3);
    expect(terrain.heightAt(9.5, 4)).toBeCloseTo(10 + 0.95, 2);
    expect(terrain.heightAt(10.5, 4)).toBeCloseTo(10 + 1.05, 2);
  });

  it("annonce les bords de la zone et qui est prêt", () => {
    const { manifest, terrain } = twoTiles();
    expect([terrain.xMin, terrain.xMax, terrain.yMin, terrain.yMax]).toEqual([0, 20, 0, 10]);
    expect(terrain.ready(manifest.tiles[0]!)).toBe(false);
    terrain.setBlock("0_0", TiledTerrain.decodeBlock(block(0)));
    expect(terrain.ready(manifest.tiles[0]!)).toBe(false);
    terrain.setBlock("1_0", TiledTerrain.decodeBlock(block(10)));
    expect(terrain.ready(manifest.tiles[0]!)).toBe(true);
    terrain.drop("1_0");
    expect(terrain.has("1_0")).toBe(false);
    expect(terrain.loaded).toBe(1);
  });

  it("n'attend pas une voisine qui n'existe pas ou dont le bloc est introuvable", async () => {
    const { manifest } = twoTiles();
    manifest.tiles.pop();
    const terrain = new TiledTerrain(manifest, Terrain.decode(manifest.coarse, new Uint16Array(15).buffer), () => Promise.reject(new Error("absent")));
    terrain.setBlock("0_0", TiledTerrain.decodeBlock(block(0)));
    expect(terrain.ready(manifest.tiles[0]!)).toBe(true);
    const full = twoTiles();
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const lost = new TiledTerrain(full.manifest, Terrain.decode(full.manifest.coarse, new Uint16Array(15).buffer), () => Promise.reject(new Error("absent")));
      lost.setBlock("0_0", TiledTerrain.decodeBlock(block(0)));
      expect(lost.ready(full.manifest.tiles[0]!)).toBe(false);
      await lost.request("1_0");
      expect(lost.ready(full.manifest.tiles[0]!)).toBe(true);
    } finally {
      console.error = quiet;
    }
  });

  it("charge un bloc une seule fois, même demandé plusieurs fois, et ne réessaie pas un échec", async () => {
    const { manifest } = twoTiles();
    let calls = 0;
    const terrain = new TiledTerrain(manifest, Terrain.decode(manifest.coarse, new Uint16Array(15).buffer), (id) => {
      calls++;
      return id === "0_0" ? Promise.resolve(block(0)) : Promise.reject(new Error("absent"));
    });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await Promise.all([terrain.request("0_0"), terrain.request("0_0")]);
      await terrain.request("1_0");
      await terrain.request("1_0");
    } finally {
      console.error = quiet;
    }
    expect(terrain.has("0_0")).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("relief réel par tuiles", () => {
  const { terrain, manifest } = loadRealWorld();

  it("garde les altitudes de l'ancien relief global (relevées avant le découpage)", () => {
    const expected: [number, number, number][] = [[0, 0, -2.262], [-95, -75, -0.672], [250, 120, -0.766], [-330, -250, -12.169], [10.5, 35.5, -3.716], [-270, 100.3, -13.696], [480, -12, 11.894]];
    for (const [x, y, z] of expected) expect(terrain.heightAt(x, y)).toBeCloseTo(z, 2);
  });

  it("est continu de part et d'autre de chaque frontière de tuile", () => {
    let worst = 0;
    const ids = new Set(manifest.tiles.map((t) => t.id));
    for (const t of manifest.tiles) {
      const [x0, y0, x1, y1] = t.bounds;
      for (let k = 1; k < 25; k++) {
        const u = k / 25;
        // Frontière est et nord (si la tuile voisine existe) : même point vu de chaque côté, à 2 micromètres.
        if (ids.has(`${t.col + 1}_${t.row}`)) worst = Math.max(worst, Math.abs(terrain.heightAt(x1 - 1e-6, y0 + u * (y1 - y0)) - terrain.heightAt(x1 + 1e-6, y0 + u * (y1 - y0))));
        if (ids.has(`${t.col}_${t.row + 1}`)) worst = Math.max(worst, Math.abs(terrain.heightAt(x0 + u * (x1 - x0), y1 - 1e-6) - terrain.heightAt(x0 + u * (x1 - x0), y1 + 1e-6)));
      }
    }
    // Même au pied d'un talus raide (pente de plusieurs m/m), 2 µm de distance donnent moins de 0,1 mm d'écart : pas de couture.
    expect(worst).toBeLessThan(1e-4);
  });

  it("le relief grossier suit le relief fin à quelques mètres près au pire (talus), et à moins de 1,5 m presque partout", () => {
    const diffs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const [x0, y0, x1, y1] = manifest.zone;
      const x = x0 + 1 + ((i * 7919) % Math.floor(x1 - x0 - 2)), y = y0 + 1 + ((i * 104729) % Math.floor(y1 - y0 - 2));
      diffs.push(Math.abs(terrain.coarse.heightAt(x, y) - terrain.heightAt(x, y)));
    }
    diffs.sort((a, b) => a - b);
    expect(diffs[Math.floor(diffs.length * 0.99)]!).toBeLessThan(1.5);
    expect(diffs[diffs.length - 1]!).toBeLessThan(6);
  });
});
