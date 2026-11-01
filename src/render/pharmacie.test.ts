import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";
import { crossFlag, pharmacyCross } from "./shopfront";

const bounds = (mb: MeshBuilder): { min: number[]; max: number[] } => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mb.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k]!, mb.positions[i]!);
    max[k] = Math.max(max[k]!, mb.positions[i]!);
  }
  return { min, max };
};

/** D159 : la façade de la Grande Pharmacie Bonaparte d'après photos (`fronts` de manual.json) et la croix en drapeau. */
describe("Grande Pharmacie Bonaparte (D159)", () => {
  const tile = JSON.parse(readFileSync("public/data/tiles/26_35.json", "utf8")) as TileData;
  const f: FacadeFiche = tile.fiches.find((q) => q.id === "BATIMENT0000000348854039")!;
  const d = f.ground.devanture!;

  it("vue sur photo, seule dans sa fiche, devanture moderne qui tient dans le mur d'entrée (18,5 m)", () => {
    expect(f.status).toBe("observed");
    expect(f.ground.shops).toHaveLength(1);
    expect(f.ground.shops![0]).toMatchObject({ name: "Grande Pharmacie Bonaparte", kind: "pharmacy", wall: 9 });
    const wall = f.walls[f.ground.front!]!;
    expect(f.ground.front).toBe(9);
    expect(wall.role).toBe("street");
    const width = d.bays.reduce((a, q) => a + q[1], 0);
    expect(d.modern).toBeDefined();
    expect(d.s0).toBe(0);
    expect(width).toBeGreaterThan(wall.length - 0.05);
    expect(width).toBeLessThanOrEqual(wall.length + 0.01);
    expect(d.h).toBeLessThanOrEqual(f.storeys.ground + 0.01);
    expect(d.sill).toBeLessThan(d.top);
    // Étage crème à balcons de fer forgé.
    expect(f.materials.wall.color).toBe("#e8e2d0");
    expect(f.facade.balcony).toBe("individuel");
  });

  it("de gauche à droite : La Poste, la pharmacie (deux bandeaux), la porte grise ; enseigne, projecteurs, croix et bandeaux sur des travées vitrées", () => {
    const m = d.modern!;
    const words = m.words.parts.map((p) => p[0]).join(" ");
    expect(words).toBe("GRANDE PHARMACIE BONAPARTE");
    expect(m.words.parts[1]![1]).not.toBe(m.words.parts[0]![1]);
    expect(m.spots!.s).toHaveLength(6);
    expect(d.bays[d.bays.length - 1]![0]).toBe("door");
    for (const [bay] of m.banners!) expect(["window", "shopdoor"]).toContain(d.bays[bay]![0]);
    // Les lettres sont sur la partie vitrée de la pharmacie, à droite de la Poste.
    const starts: number[] = [];
    let s = d.s0;
    for (const [, w] of d.bays) {
      starts.push(s);
      s += w;
    }
    expect(m.words.at).toBeGreaterThan(starts[5]!);
    expect(m.logos!.some((l) => l[3] === "#ffd400")).toBe(true);
    // La croix est au-dessus des vitrines, à la jonction Poste / pharmacie, et mesure 0,85 m.
    expect(m.cross!.size).toBeCloseTo(0.85, 2);
    expect(m.cross!.z - m.cross!.size / 2).toBeGreaterThan(d.top);
    expect(m.cross!.s).toBeGreaterThan(starts[4]! - 0.1);
    expect(m.cross!.s).toBeLessThan(m.words.at);
  });

  it("géométrie : sommets finis, coût borné, vitrines et croix allumées la nuit, croix perpendiculaire au mur", () => {
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildDevanture(mb, glow, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, f.ground.shopfront!.color);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(2000);
    expect(glow.positions.length / 9).toBeGreaterThanOrEqual(20);
    // Rien ne sort du mur de plus de 1,6 m (la croix est le plus saillant), et rien ne passe derrière le mur.
    const b = bounds(mb);
    expect(b.min[2]).toBeGreaterThan(-0.2);
    expect(b.max[2]).toBeLessThan(1.6);
  });
});

describe("croix de pharmacie en drapeau (D159)", () => {
  it("croix grecque de 0,85 m dans le plan perpendiculaire au mur, finie, sans potence plus longue que la croix", () => {
    const mb = new MeshBuilder(), face = new MeshBuilder();
    crossFlag(mb, 0, 0, 0, -1, 5, 0.85, face);
    const b = bounds(mb);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    // Repère three : (x, z, -y) ; le mur est en y = 0, la croix s'étend vers y < 0 (z three > 0), à 5 m ± 0,43.
    expect(b.max[1]! - b.min[1]!).toBeCloseTo(0.85, 2);
    expect(b.min[1]).toBeCloseTo(5 - 0.425, 2);
    // Largeur le long du mur : 0,22 m d'épaisseur ; profondeur : 0,85 m de croix, potence comprise jusqu'au mur.
    expect(b.max[0]! - b.min[0]!).toBeLessThan(0.3);
    expect(b.max[2]! - b.min[2]!).toBeLessThanOrEqual(0.86 + 0.85 + 0.01);
    expect(face.positions.length).toBeGreaterThan(0);
  });

  it("les pharmacies génériques reçoivent la même croix", () => {
    const mb = new MeshBuilder();
    pharmacyCross(mb, { x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: -1, width: 4, zTop: 2.6, zSign: 2.8, key: "t" });
    const b = bounds(mb);
    expect(b.max[1]! - b.min[1]!).toBeCloseTo(0.85, 2);
    expect(mb.positions.length / 9).toBeLessThan(120);
  });
});
