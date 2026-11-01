import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Devanture, FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D185 : hôtel Saint-Louis (façade sans commerce), La Trattoria, Le Lutrin (angle), Chez Daddy et sa fresque (angle). */
const tiles = new Map<string, TileData>();
const tile = (t: string): TileData => {
  if (!tiles.has(t)) tiles.set(t, JSON.parse(readFileSync(`public/data/tiles/${t}.json`, "utf8")) as TileData);
  return tiles.get(t)!;
};
const fiche = (t: string, id: string): FacadeFiche => tile(t).fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
const ends = (t: string, id: string, wall: number): { a: [number, number]; b: [number, number] } => {
  const ring = tile(t).buildings.find((b) => b.id === `BATIMENT0000000${id}`)!.ring;
  const w = fiche(t, id).walls[wall]!;
  return { a: [ring[2 * w.a]!, ring[2 * w.a + 1]!], b: [ring[2 * w.b]!, ring[2 * w.b + 1]!] };
};
const near = (p: [number, number], q: [number, number]): void => {
  expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.06);
};
const HOTEL: [string, string] = ["26_34", "348853299"];
const SHOPS: [string, string, string, string][] = [
  ["26_33", "348852942", "La Trattoria", "restaurant"],
  ["26_33", "348853042", "Le Lutrin", "restaurant"],
  ["26_35", "348854035", "Chez Daddy", "cafe"],
];
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
const width = (d: Devanture): number => d.bays.reduce((a, q) => a + q[1], 0);
const all = (f: FacadeFiche): [Devanture, number][] => [[f.ground.devanture!, f.ground.front!], ...(f.ground.corner ? [[f.ground.corner.devanture, f.ground.corner.wall] as [Devanture, number]] : [])];
const inside = (d: Devanture, s: number, label: string): void => {
  expect(s, label).toBeGreaterThanOrEqual(d.s0 - 0.01);
  expect(s, label).toBeLessThanOrEqual(d.s0 + width(d) + 0.01);
};

describe("boutiques d'après photos, lot D185", () => {
  it("chaque devanture tient dans son mur de rue, avec ses plaques et ses textes", () => {
    for (const [t, id] of [...SHOPS.map((x) => [x[0], x[1]] as [string, string]), HOTEL]) {
      const f = fiche(t, id);
      expect(f.status, id).toBe("observed");
      for (const [d, wi] of all(f)) {
        const wall = f.walls[wi]!;
        expect(wall.role, id).toBe("street");
        expect(d.s0 + width(d), id).toBeLessThanOrEqual(wall.length + 0.01);
        expect(d.sill).toBeLessThan(d.top);
        for (const q of d.modern!.plates ?? []) inside(d, q[0], `${id} plaque`);
        for (const q of d.modern!.texts ?? []) inside(d, q[0], `${id} ${q[3]}`);
      }
      expect(f.ground.devanture!.h, id).toBeLessThanOrEqual(f.storeys.ground + 0.7);
    }
    for (const [t, id, name, kind] of SHOPS) {
      const s = fiche(t, id).ground.shops![0]!;
      expect(s.name).toBe(name);
      expect(s.kind).toBe(kind);
    }
  });

  it("hôtel Saint-Louis : façade de huit travées sans commerce, sur la rue de l'Arbalète (mur 5, 27,3 m)", () => {
    const f = fiche(...HOTEL), d = f.ground.devanture!;
    expect(f.address).toContain("6 Rue de l");
    expect(f.ground.front).toBe(5);
    expect(f.walls[5]!.length).toBeCloseTo(27.32, 1);
    expect(width(d)).toBeCloseTo(27.32, 1);
    expect(f.ground.shops).toHaveLength(0);
    expect(d.bays.filter((q) => q[0] === "shopdoor")).toHaveLength(1);
    expect(d.modern!.texts!.map((q) => q[3]).join(" ")).toContain("LOUIS");
  });

  it("La Trattoria : au 4 rue des Bancs (Don Cabillaud gardé), doublon retiré du 2, qui n'a plus de vitrine générique", () => {
    const f = fiche("26_33", "348852942");
    expect(f.ground.shops!.some((s) => s.name === "Le Monde de Don Cabillaud")).toBe(true);
    expect(f.ground.shops![0]!.terrace!.screen).toBeDefined();
    expect(f.ground.devanture!.s0 + width(f.ground.devanture!)).toBeLessThanOrEqual(9.32);
    const two = fiche("26_33", "348852941");
    expect(two.ground.shops).toHaveLength(0);
    expect(two.ground.kind).toBe("dwelling");
    const count = tile("26_33").fiches.filter((x) => x.ground.shops?.some((s) => s.name === "La Trattoria")).length;
    expect(count).toBe(1);
  });

  it("Le Lutrin : angle nord-ouest, mur 5 (place) puis mur 4 (rue), le mur 4 finit au sommet commun", () => {
    const f = fiche("26_33", "348853042");
    expect(f.ground.front).toBe(5);
    expect(f.ground.corner!.wall).toBe(4);
    near(ends("26_33", "348853042", 4).b, ends("26_33", "348853042", 5).a);
    expect(f.ground.devanture!.modern!.texts!.some((q) => q[3].includes("TERRASSE"))).toBe(true);
    expect(f.facade.window.frameColor).toBe("#7a2323");
  });

  it("Chez Daddy : café à droite du mur 2, entrée de l'immeuble à sa gauche, mur est (mur 3) voisin avec fresque", () => {
    const f = fiche("26_35", "348854035"), d = f.ground.devanture!;
    expect(f.walls[2]!.length).toBeCloseTo(26.59, 1);
    expect(d.s0 + width(d)).toBeGreaterThan(26);
    expect(d.bays[0]![0]).toBe("shopdoor");
    expect(d.awning!.color).toBe("#e8b92d");
    expect(f.ground.corner!.wall).toBe(3);
    near(ends("26_35", "348854035", 2).b, ends("26_35", "348854035", 3).a);
    const c = f.ground.corner!.devanture;
    expect(width(c)).toBeCloseTo(11.3, 1);
    expect(c.modern!.texts!.some((q) => q[3] === "LA FRESQUE D'AUTUN")).toBe(true);
    expect(c.bays.some((q) => q[0] === "door")).toBe(true);
  });

  it("géométrie : sommets finis, coût borné, le store ajoute des triangles", () => {
    for (const [t, id] of [...SHOPS.map((x) => [x[0], x[1]] as [string, string]), HOTEL]) {
      const f = fiche(t, id);
      for (const [d] of all(f)) {
        const mb = new MeshBuilder();
        buildDevanture(mb, null, null, frame, d, f.ground.shopfront!.color);
        expect(mb.positions.every(Number.isFinite), id).toBe(true);
        expect(mb.positions.length / 9, id).toBeLessThan(2500);
      }
    }
    const f = fiche("26_35", "348854035"), d = f.ground.devanture!;
    const [a, b] = [new MeshBuilder(), new MeshBuilder()];
    buildDevanture(a, null, null, frame, d, f.ground.shopfront!.color);
    buildDevanture(b, null, null, frame, { ...d, awning: undefined } as never, f.ground.shopfront!.color);
    expect(a.positions.length).toBeGreaterThan(b.positions.length);
  });
});
