import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HexagoneModel, HeightField, LodBuilding, TileData, TileKinds } from "../data/types";
import { HEX_PROP_RADIUS, HEX_SIDES, hexagoneFootAt, hexagoneShape, landmarkCircles } from "../core/landmarks";
import { buildHexagone } from "./hexagone";
import { UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { MeshBuilder } from "./geometry";

/** D165 : l'Hexagone (lot 1 de docs/plans/hexagone.md) : pyramide à 12 pans mesurée au LiDAR sur une couronne de six terrasses. */
const BID = "BATIMENT0000000348844694";
const kinds = JSON.parse(readFileSync("public/data/kinds/27_35.json", "utf8")) as TileKinds;
const m = kinds.buildings[BID]!.hex as HexagoneModel;
/** Le bâtiment seul, sans le mobilier du parvis (qui s'étend jusqu'à 45 m du sommet). */
const bare: HexagoneModel = { ...m };
delete bare.props;
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

describe("L'Hexagone (D166) : façades", () => {
  const F = m.front!, N = m.ne!;

  it("façade ouest : mur droit à la hauteur du contour, mesurée d'après le relevé (32 m de large, auvent central de 10 m saillant de 2 m)", () => {
    expect(F.cap).toBe(275);
    expect(F.s[1] - F.s[0]).toBeGreaterThan(30);
    expect(F.s[1] - F.s[0]).toBeLessThan(36);
    expect(F.canopy[1] - F.canopy[0]).toBeGreaterThan(9);
    expect(F.canopy[2]).toBeGreaterThan(1.5);
    expect(F.canopy[2]).toBeLessThan(3);
    expect(F.canopy[0]).toBeGreaterThan(F.s[0]);
    expect(F.canopy[1]).toBeLessThan(F.s[1]);
    const [gl, low, rib, top] = F.levels;
    expect(gl).toBeLessThan(low);
    expect(low).toBeLessThan(rib);
    expect(rib).toBeLessThan(top);
    // Hauteur du bandeau haut : 4,7 à 5,3 m au-dessus du sol.
    expect(top - m.g).toBeGreaterThan(4.7);
    expect(top - m.g).toBeLessThan(5.3);
  });

  it("la ligne de la façade passe près des sommets du contour de ce côté (le joueur s'arrête au plus à 3 m des vitres)", () => {
    const n = [Math.sin((F.cap * Math.PI) / 180), Math.cos((F.cap * Math.PI) / 180)];
    const proj: number[] = [];
    for (let i = 0; i < m.ring.length; i += 2) {
      const dx = m.ring[i]! - m.c[0], dy = m.ring[i + 1]! - m.c[1];
      const lat = -dx * n[1]! + dy * n[0]!;
      const d = dx * n[0]! + dy * n[1]!;
      if (d > 15 && lat > F.s[0] + 2 && lat < F.s[1] - 2) proj.push(d);
    }
    expect(proj.length).toBeGreaterThan(5);
    expect(F.d - Math.max(...proj)).toBeGreaterThan(-3);
    expect(F.d - Math.min(...proj)).toBeLessThan(6);
  });

  it("quatre portes doubles au moins dont trois sous l'auvent, toutes à l'intérieur du mur et sans se chevaucher", () => {
    expect(F.doors.length).toBeGreaterThanOrEqual(4);
    const sorted = [...F.doors].sort((a, b) => a - b);
    sorted.forEach((c, i) => {
      expect(c - 1.2).toBeGreaterThan(F.s[0]);
      expect(c + 1.2).toBeLessThan(F.s[1]);
      if (i) expect(c - sorted[i - 1]!).toBeGreaterThan(2.5);
    });
    expect(F.doors.filter((c) => c - 1.2 >= F.canopy[0] && c + 1.2 <= F.canopy[1]).length).toBeGreaterThanOrEqual(3);
    expect(F.sign[0]).toBe("HEXAGONE");
    expect(F.sign[1]).toBeGreaterThan(F.canopy[0]);
    expect(F.sign[1]).toBeLessThan(F.canopy[1]);
  });

  it("face nord-est : étage en porte-à-faux sur des poteaux, le plus haut des côtés (+1,1 m sur la façade)", () => {
    expect(N.cap).toBe(35);
    expect(N.over).toBeGreaterThan(1);
    expect(N.floor).toBeGreaterThan(m.g + 2.8);
    expect(N.top).toBeGreaterThan(N.floor + 2);
    expect(N.top - m.sides[4]![1]).toBeGreaterThan(0.9);
    expect(N.poles.length).toBeGreaterThanOrEqual(4);
    for (const s of [...N.poles, ...N.doors, N.window[0], N.oriel[0]]) {
      expect(s).toBeGreaterThan(N.s[0]);
      expect(s).toBeLessThan(N.s[1]);
    }
  });

  it("le maillage porte l'enseigne « HEXAGONE » (une fois), des vitrages allumés la nuit et reste sous 15 000 triangles", () => {
    const names: string[] = [];
    const atlas = { get: (text: string) => { names.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
    const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
    buildHexagone(sinks, m, flat);
    expect(names).toEqual(["HEXAGONE"]);
    expect(sinks.names.positions.length).toBeGreaterThan(0);
    expect(sinks.glow.positions.length).toBeGreaterThan(0);
    expect(sinks.solid.triangleCount).toBeLessThan(15000);
    expect(sinks.solid.positions.every(Number.isFinite) && sinks.glow.positions.every(Number.isFinite) && sinks.names.positions.every(Number.isFinite)).toBe(true);
  });
});

describe("L'Hexagone (D168) : mobilier du parvis", () => {
  const props = m.props!;
  const of = (k: string): typeof props => props.filter((q) => q.k === k);

  it("la sphère (au pied de la brique), une colonne Morris, un lampadaire, trois drapeaux (France, Europe, un autre), au moins deux bacs, trois arceaux", () => {
    expect(of("sphere")).toHaveLength(1);
    expect(of("column")).toHaveLength(1);
    expect(of("lamp")).toHaveLength(1);
    expect(of("flag").map((q) => q.v).sort()).toEqual([0, 1, 2]);
    expect(of("planter").length).toBeGreaterThanOrEqual(2);
    expect(of("rack").length).toBeGreaterThanOrEqual(3);
    // Sphère : position lue sur l'orthophotographie (rond de 2 m et son ombre).
    expect(Math.hypot(of("sphere")[0]!.x - 340.4, of("sphere")[0]!.y - 175.2)).toBeLessThan(1);
  });

  it("tout est sur le parvis ou près de lui, hors du bâtiment, à plus de 3 m de la façade ; deux objets ne se chevauchent pas", () => {
    const tile = JSON.parse(readFileSync("public/data/tiles/27_35.json", "utf8")) as TileData;
    const inRing = (r: readonly number[], x: number, y: number): boolean => {
      let inside = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        if (r[i + 1]! > y !== r[j + 1]! > y && x < ((r[j]! - r[i]!) * (y - r[i + 1]!)) / (r[j + 1]! - r[i + 1]!) + r[i]!) inside = !inside;
      }
      return inside;
    };
    const plaza = tile.ground["plaza_filet"] ?? [];
    for (const q of props) {
      expect(inRing(m.ring, q.x, q.y), `${q.k} dans le bâtiment`).toBe(false);
      expect(Math.hypot(q.x - 340, q.y - 176)).toBeLessThan(20);
      const n = [Math.sin((m.front!.cap * Math.PI) / 180), Math.cos((m.front!.cap * Math.PI) / 180)];
      const t = (q.x - m.c[0]) * n[0]! + (q.y - m.c[1]) * n[1]! - m.front!.d;
      expect(t, `${q.k} trop près de la façade`).toBeGreaterThan(3);
    }
    expect(plaza.length).toBeGreaterThan(0);
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const d = Math.hypot(props[i]!.x - props[j]!.x, props[i]!.y - props[j]!.y);
        const r = (HEX_PROP_RADIUS[props[i]!.k] ?? 0) + (HEX_PROP_RADIUS[props[j]!.k] ?? 0);
        expect(d, `${props[i]!.k} / ${props[j]!.k}`).toBeGreaterThan(r * 0.9);
      }
    }
  });

  it("la sphère, la colonne, les bacs, le lampadaire et les mâts sont des obstacles ; les arceaux se franchissent", () => {
    const tile = JSON.parse(readFileSync("public/data/tiles/27_35.json", "utf8")) as TileData;
    const circles = landmarkCircles(kinds, tile.buildings);
    const at = (x: number, y: number): number | undefined => circles.find(([cx, cy]) => Math.hypot(cx - x, cy - y) < 0.01)?.[2];
    for (const q of props) {
      const want = HEX_PROP_RADIUS[q.k]!;
      if (want > 0) expect(at(q.x, q.y), q.k).toBe(want);
      else expect(at(q.x, q.y)).toBeUndefined();
    }
    expect(HEX_PROP_RADIUS["sphere"]).toBeGreaterThan(1.2);
  });

  it("maillage : hauteurs vraisemblables (drapeaux à 7,5 m, sphère à 3,2 m), couleurs finies, moins de 15 000 triangles en tout", () => {
    const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas: { get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as SignAtlas };
    buildHexagone(sinks, bare, flat);
    const before = sinks.solid.triangleCount;
    const only: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas: sinks.atlas };
    buildHexagone(only, m, flat);
    const added = only.solid.triangleCount - before;
    expect(added).toBeGreaterThan(1000);
    expect(only.solid.triangleCount).toBeLessThan(15000);
    expect(only.solid.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1.5)).toBe(true);
    expect(only.glow.positions.length).toBeGreaterThan(sinks.glow.positions.length);
  });
});

describe("L'Hexagone (D165) : maillage et silhouette", () => {
  const texts: string[] = [];
  const atlas = { get: (text: string) => { texts.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
  const mb = sinks.solid;
  buildHexagone(sinks, bare, flat);

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
