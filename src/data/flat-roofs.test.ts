import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../render/geometry";
import { rooftopBox } from "../render/stylized";
import type { LodBuilding, TileData } from "./types";

/** D170 : les deux barres voisines de l'Hexagone ont un toit-terrasse (lot 6 de docs/plans/hexagone.md), mesuré au MNS LiDAR. */
const tile = JSON.parse(readFileSync("public/data/tiles/27_36.json", "utf8")) as TileData;
const lod = JSON.parse(readFileSync("public/data/lod/27_36.json", "utf8")) as LodBuilding[];
const crc = (s: string): number => {
  let c = ~0;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i); for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
};
const get = (n: string) => tile.buildings.find((b) => b.id === `BATIMENT0000000348848${n}`)!;
const B87 = get("387"), B77 = get("377");

const inRing = (r: readonly number[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1]! > y !== r[j + 1]! > y && x < ((r[j]! - r[i]!) * (y - r[i + 1]!)) / (r[j + 1]! - r[i + 1]!) + r[i]!) inside = !inside;
  }
  return inside;
};

describe("toits-terrasses des barres de l'Hexagone (D170)", () => {
  it("…387 : un seul niveau à +10,65 (LiDAR), plus de croupes", () => {
    expect(B87.roofKind).toBe("flat");
    expect(B87.faces).toHaveLength(1);
    expect(B87.faces[0]!.p).toEqual([0, 0, 10.65]);
    expect(B87.eave).toBe(10.65);
    expect(B87.ridge).toBe(10.65);
    expect(B87.top.every((t) => t === 10.65)).toBe(true);
    expect(B87.steps).toHaveLength(0);
  });

  it("…377 : deux niveaux (+8,43 au sud, +7,28 au nord), un redan de 1,15 m, murs montés à leur niveau", () => {
    expect(B77.roofKind).toBe("flat");
    expect(B77.faces.map((f) => f.p[2]).sort()).toEqual([7.28, 8.43]);
    expect(B77.steps).toHaveLength(1);
    const [, , lo, hi] = B77.steps[0]!;
    expect(hi! - lo!).toBeCloseTo(1.15, 2);
    // Les murs du sud sont à 8,43, ceux du nord à 7,28 ; huit sommets (quatre coins et deux paires de part et d'autre du redan).
    expect(B77.ring.length / 2).toBe(8);
    // Le redan est la droite perpendiculaire à l'axe du bâtiment par (408 ; 275,4), de direction (0,995 ; 0,1) : au nord 7,28, au sud 8,43 ; les quatre sommets posés sur la droite
    // (deux paires) prennent le niveau de leur côté avant ou après.
    let onLine = 0;
    for (let i = 0; i < B77.top.length; i++) {
      const x = B77.ring[2 * i]!, y = B77.ring[2 * i + 1]!;
      const side = 0.995 * (y - 275.4) - 0.1 * (x - 408);
      if (Math.abs(side) < 0.1) { onLine++; expect([7.28, 8.43]).toContain(B77.top[i]); continue; }
      expect(B77.top[i], `sommet ${i} (${x}, ${y})`).toBe(side > 0 ? 7.28 : 8.43);
    }
    expect(onLine).toBe(4);
    // Aucun côté de longueur nulle (les normales des murs en dépendent).
    for (let i = 0; i < B77.ring.length; i += 2) {
      const j = (i + 2) % B77.ring.length;
      expect(Math.hypot(B77.ring[j]! - B77.ring[i]!, B77.ring[j + 1]! - B77.ring[i + 1]!)).toBeGreaterThan(0.01);
    }
  });

  it("édicules : 3 sur …387, 12 sur …377, de 3 m² au moins, dans l'emprise, posés sur le toit de leur niveau, à moins de 3 m de haut", () => {
    expect(B87.rooftop).toHaveLength(3);
    expect(B77.rooftop).toHaveLength(12);
    for (const b of [B87, B77]) {
      const levels = b.faces.map((f) => f.p[2]);
      for (const [x, y, sx, sy, z0, z1] of b.rooftop!) {
        expect(sx! * sy!).toBeGreaterThanOrEqual(3);
        expect(inRing(b.ring, x!, y!)).toBe(true);
        expect(levels).toContain(z0);
        expect(z1! - z0!).toBeGreaterThan(0.6);
        expect(z1! - z0!).toBeLessThan(3);
      }
    }
  });

  it("matériau « terrasse » (fiche et silhouette lointaine, au niveau du toit) ; le jumeau …380 déjà plat n'a pas bougé", () => {
    for (const b of [B87, B77]) {
      expect(tile.fiches.find((f) => f.id === b.id)!.materials.roof).toBe("terrasse");
      const e = lod.find((q) => q.k === crc(b.id))!;
      expect(e.m).toBe("terrasse");
      expect(e.e).toBe(e.g);
      expect(e.e).toBeCloseTo(b.faces[0]!.p[2], 0);
    }
    expect(get("380").rooftop).toBeUndefined();
    expect(get("380").roofKind).toBe("flat");
  });

  it("un édicule se dessine : cinq faces, normales unitaires horizontales, rien d'infini", () => {
    const mb = new MeshBuilder();
    rooftopBox(mb, 100, 200, 4, 2, 8, 10, 30);
    expect(mb.triangleCount).toBe(10);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < 8 * 9; i += 9) {
      const [nx, ny, nz] = [mb.normals[i]!, mb.normals[i + 1]!, mb.normals[i + 2]!];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      expect(Math.abs(ny)).toBeLessThan(1e-9);
    }
    // Aucun sommet à plus de la demi-diagonale du centre : (4 × 2) -> 2,24 m.
    for (let i = 0; i < mb.positions.length; i += 3) expect(Math.hypot(mb.positions[i]! - 100, -mb.positions[i + 2]! - 200)).toBeLessThan(2.3);
  });
});
