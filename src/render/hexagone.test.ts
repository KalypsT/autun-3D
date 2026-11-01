import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HexagoneModel, HeightField, LodBuilding, TileKinds } from "../data/types";
import { HEX_SIDES, hexagoneFootAt, hexagoneShape } from "../core/landmarks";
import { buildHexagone } from "./hexagone";
import { MeshBuilder } from "./geometry";

/** D165 : l'Hexagone (lot 1 de docs/plans/hexagone.md) : pyramide à 12 pans mesurée au LiDAR sur une couronne de six terrasses. */
const BID = "BATIMENT0000000348844694";
const kinds = JSON.parse(readFileSync("public/data/kinds/27_35.json", "utf8")) as TileKinds;
const m = kinds.buildings[BID]!.hex as HexagoneModel;
const flat: HeightField = { heightAt: () => m.g, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };

describe("L'Hexagone (D165) : modèle de données", () => {
  it("le bâtiment BD TOPO porte le modèle et reste un bâtiment « culture »", () => {
    expect(kinds.buildings[BID]!.k).toBe("culture");
    expect(m).toBeDefined();
  });

  it("pyramide mesurée au LiDAR : sommet à 12,8 ± 0,5 m du sol, pente du plan entre 0,17 et 0,24, jupon plus raide, pied au-dessus des terrasses", () => {
    expect(m.apex - m.g).toBeGreaterThan(12.3);
    expect(m.apex - m.g).toBeLessThan(13.3);
    const slope = (m.apex - m.skirt[1]) / m.skirt[0];
    expect(slope).toBeGreaterThan(0.17);
    expect(slope).toBeLessThan(0.24);
    const steep = (m.skirt[1] - m.foot) / (m.apothem - m.skirt[0]);
    expect(steep).toBeGreaterThan(0.5);
    expect(m.skirt[0]).toBeLessThan(m.apothem);
    for (const [, z] of m.sides) expect(z + 0.45).toBeLessThan(m.foot);
  });

  it("douze pans réguliers : arêtes tous les 30° à partir de 20°, pied et rupture de pente sur deux cercles concentriques", () => {
    const { foot, mid } = hexagoneShape(m);
    expect(foot).toHaveLength(12);
    expect(m.hip).toBeCloseTo(20, 5);
    foot.forEach(([x, y], i) => {
      const cap = ((Math.atan2(x - m.c[0], y - m.c[1]) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(((cap - (m.hip + 30 * i) + 540) % 360) - 180)).toBeLessThan(1e-6);
      expect(Math.hypot(x - m.c[0], y - m.c[1])).toBeCloseTo(m.apothem / Math.cos(Math.PI / 12), 6);
    });
    expect(Math.hypot(mid[0]![0] - m.c[0], mid[0]![1] - m.c[1])).toBeCloseTo(m.skirt[0] / Math.cos(Math.PI / 12), 6);
    // Au milieu d'un pan, le pied est à l'apothème.
    const [fx, fy] = hexagoneFootAt(m, m.hip + 15);
    expect(Math.hypot(fx - m.c[0], fy - m.c[1])).toBeCloseTo(m.apothem, 6);
  });

  it("six secteurs de normales 35° + 60°·k : la façade principale (275°) est à 30 m du sommet, au niveau des terrasses de la façade", () => {
    expect(HEX_SIDES).toEqual([35, 95, 155, 215, 275, 335]);
    expect(m.sides).toHaveLength(6);
    expect(m.sides[4]![0]).toBeGreaterThan(29.5);
    expect(m.sides[4]![0]).toBeLessThan(31);
    // Le côté nord-est (photo 5) est le plus haut ; la pyramide y est la plus basse au sud-est.
    const zs = m.sides.map((s) => s[1]);
    expect(Math.max(...zs)).toBe(m.sides[0]![1]);
    expect(m.sides[0]![1] - m.sides[4]![1]).toBeGreaterThan(0.9);
  });

  it("le contour des murs est l'emprise BD TOPO (celle des collisions) et le sommet est à l'intérieur", () => {
    expect(m.ring.length).toBeGreaterThanOrEqual(40);
    let inside = false;
    for (let i = 0, j = m.ring.length - 2; i < m.ring.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [m.ring[i]!, m.ring[i + 1]!, m.ring[j]!, m.ring[j + 1]!];
      if (yi > m.c[1] !== yj > m.c[1] && m.c[0] < xi + ((m.c[1] - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
    }
    expect(inside).toBe(true);
  });
});

describe("L'Hexagone (D165) : maillage et silhouette", () => {
  const mb = new MeshBuilder();
  buildHexagone(mb, null, m, flat);

  it("quelques milliers de triangles au plus, sans valeur absurde", () => {
    expect(mb.triangleCount).toBeGreaterThan(300);
    expect(mb.triangleCount).toBeLessThan(15000);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.normals.every(Number.isFinite)).toBe(true);
  });

  it("le point le plus haut est le sommet de la pyramide, au centre, et rien ne dépasse le contour de plus de 1 m", () => {
    let top = -1e9, tx = 0, tz = 0;
    for (let i = 0; i < mb.positions.length; i += 3) {
      const y = mb.positions[i + 1]!;
      if (y > top) { top = y; tx = mb.positions[i]!; tz = -mb.positions[i + 2]!; }
      // Dans le repère three : x, haut, −nord. Tout point reste à moins de 42 m du sommet (contour jusqu'à 39 m).
      expect(Math.hypot(mb.positions[i]! - m.c[0], -mb.positions[i + 2]! - m.c[1])).toBeLessThan(42);
    }
    expect(top).toBeCloseTo(m.apex, 5);
    expect(Math.hypot(tx - m.c[0], tz - m.c[1])).toBeLessThan(0.01);
  });

  it("le toit est vu d'en haut : les pans regardent vers le haut et vers l'extérieur", () => {
    let roofFaces = 0;
    for (let i = 0; i < mb.normals.length; i += 9) {
      const [nx, ny, nz] = [mb.normals[i]!, mb.normals[i + 1]!, mb.normals[i + 2]!];
      const [a, b, c] = [mb.positions[i]!, mb.positions[i + 1]!, mb.positions[i + 2]!];
      if (ny > 0.5 && ny < 0.99 && b > m.skirt[1] - 0.1 && (a - m.c[0]) * nx + (-c - m.c[1]) * -nz > 0) roofFaces++;
    }
    expect(roofFaces).toBeGreaterThanOrEqual(12);
  });

  it("silhouette lointaine : le prisme de la pyramide a le sommet du modèle et la couronne l'emprise du bâtiment", () => {
    const lod = JSON.parse(readFileSync("public/data/lod/27_35.json", "utf8")) as LodBuilding[];
    const crc = (s: string): number => {
      let c = ~0;
      for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i); for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
      return ~c >>> 0;
    };
    const mine = lod.filter((e) => e.k === crc(BID));
    expect(mine).toHaveLength(2);
    expect(Math.max(...mine.map((e) => e.g))).toBeCloseTo(m.apex, 1);
    expect(mine.find((e) => e.r.length === 24)!.e).toBeCloseTo(m.foot, 1);
    expect(mine.find((e) => e.r.length === m.ring.length)).toBeDefined();
  });
});
