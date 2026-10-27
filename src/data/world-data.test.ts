import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";

const { manifest } = loadRealWorld();
const file = (name: string): string => `public/data/${name}`;

describe("plan du monde (public/data/world.json)", () => {
  it("place chaque tuile sur la grille mondiale, avec un identifiant colonne_ligne", () => {
    const [gx, gy] = manifest.gridOrigin;
    const ids = new Set<string>();
    for (const t of manifest.tiles) {
      expect(t.id).toBe(`${t.col}_${t.row}`);
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.col).toBeLessThan(manifest.cols);
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeLessThan(manifest.rows);
      expect(t.bounds).toEqual([gx + t.col * manifest.tileSize, gy + t.row * manifest.tileSize, gx + (t.col + 1) * manifest.tileSize, gy + (t.row + 1) * manifest.tileSize]);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("annonce comme limites du monde l'emprise des tuiles qui existent", () => {
    const xs = manifest.tiles.flatMap((t) => [t.bounds[0], t.bounds[2]]);
    const ys = manifest.tiles.flatMap((t) => [t.bounds[1], t.bounds[3]]);
    expect(manifest.zone).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  });

  it("a, pour chaque tuile, ses fichiers de données (tuile, relief fin, sols fins, silhouettes si elle a des bâtiments)", () => {
    for (const t of manifest.tiles) {
      for (const f of [`tiles/${t.id}.json`, `terrain/${t.id}.bin`, `ground/${t.id}_a.png`, `ground/${t.id}_b.png`]) expect(existsSync(file(f)), f).toBe(true);
      expect(existsSync(file(`lod/${t.id}.json`)), `lod/${t.id}.json`).toBe(t.lod > 0);
    }
  });

  it("a les sols grossiers de chaque super-tuile qui contient une tuile", () => {
    const cells = new Set(manifest.super.cells.map((s) => s.id));
    for (const t of manifest.tiles) {
      const id = `s${Math.floor(t.col / manifest.super.tiles)}_${Math.floor(t.row / manifest.super.tiles)}`;
      expect(cells.has(id), id).toBe(true);
      expect(existsSync(file(`ground/${id}_a.png`))).toBe(true);
      expect(existsSync(file(`ground/${id}_b.png`))).toBe(true);
    }
  });

  it("relief fin : chaque bloc a la taille annoncée et sa position sur la grille fine", () => {
    const [fx, fy] = manifest.lattice;
    for (const t of manifest.tiles.slice(0, 6)) {
      const b = readFileSync(file(`terrain/${t.id}.bin`));
      const head = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + 16));
      expect(head[3]).toBe(manifest.blockSize);
      expect(b.length).toBe(16 + 2 * manifest.blockSize ** 2);
      // Les pixels de 1 m sont sur la même grille (phase fx, fy) pour toutes les tuiles : les blocs voisins se recouvrent exactement.
      expect(Math.abs((head[1]! - fx) % 1)).toBeLessThan(1e-3);
      expect(Math.abs((head[2]! - fy) % 1)).toBeLessThan(1e-3);
      // Le bloc contient sa tuile avec au moins un pixel de marge.
      expect(head[1]!).toBeLessThanOrEqual(t.bounds[0] - 1);
      expect(head[2]!).toBeGreaterThanOrEqual(t.bounds[3] + 1);
      expect(head[1]! + manifest.blockSize).toBeGreaterThanOrEqual(t.bounds[2] + 1);
      expect(head[2]! - manifest.blockSize).toBeLessThanOrEqual(t.bounds[1] - 1);
    }
  });

  it("relief grossier : la grille couvre toutes les tuiles", () => {
    const k = manifest.coarse;
    expect(k.x0).toBeLessThanOrEqual(manifest.zone[0]);
    expect(k.x0 + k.cols * k.res).toBeGreaterThanOrEqual(manifest.zone[2]);
    expect(k.y1).toBeGreaterThanOrEqual(manifest.zone[3]);
    expect(k.y1 - k.rows * k.res).toBeLessThanOrEqual(manifest.zone[1]);
    expect(readFileSync(file("terrain/coarse.bin")).length).toBe(2 * k.cols * k.rows);
  });
});
