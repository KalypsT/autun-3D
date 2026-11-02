import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Devanture, FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D184 : Kebab Autun, Au Royaume des Fleurs (angle), Emmaüs, Tabac Presse de la Gare, hôtel du Commerce (angle), boucherie HN, Morvan Pêche. */
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
const SHOPS: [string, string, string, string][] = [
  ["25_35", "348854304", "Kebab Autun", "fast_food"],
  ["25_35", "348854245", "Au Royaume des Fleurs", "florist"],
  ["25_36", "348856222", "Emmaüs en ville", "charity"],
  ["24_37", "348856228", "Tabac Presse de la Gare", "tobacco"],
  ["24_37", "348856297", "Le Côté à Côté", "restaurant"],
  ["30_40", "348858747", "Boucherie & épicerie HN", "butcher"],
  ["26_35", "348854022", "Morvan Pêche", "fishing"],
];
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
const width = (d: Devanture): number => d.bays.reduce((a, q) => a + q[1], 0);
const all = (f: FacadeFiche): [Devanture, number][] => [[f.ground.devanture!, f.ground.front!], ...(f.ground.corner ? [[f.ground.corner.devanture, f.ground.corner.wall] as [Devanture, number]] : [])];

describe("boutiques d'après photos, lot D184", () => {
  it("chaque boutique est vue sur photo, nommée, et sa devanture tient dans son mur de rue", () => {
    for (const [t, id, name, kind] of SHOPS) {
      const f = fiche(t, id);
      expect(f.status, name).toBe("observed");
      expect(f.ground.shops![0]!.name).toBe(name);
      expect(f.ground.shops![0]!.kind).toBe(kind);
      for (const [d, wi] of all(f)) {
        const wall = f.walls[wi]!;
        expect(wall.role, name).toBe("street");
        expect(d.s0).toBeGreaterThanOrEqual(0);
        expect(d.s0 + width(d), name).toBeLessThanOrEqual(wall.length + 0.01);
        expect(d.sill).toBeLessThan(d.top);
      }
      expect(f.ground.devanture!.h, name).toBeLessThanOrEqual(f.storeys.ground + 0.7);
    }
  });

  it("plaques, textes et losange sont posés sur la devanture (abscisses du mur, pas de la devanture)", () => {
    for (const [t, id, name] of SHOPS) {
      for (const [d] of all(fiche(t, id))) {
        const m = d.modern!, lo = d.s0 - 0.01, hi = d.s0 + width(d) + 0.01;
        const inside = (s: number, label: string): void => {
          expect(s, label).toBeGreaterThanOrEqual(lo);
          expect(s, label).toBeLessThanOrEqual(hi);
        };
        for (const q of m.plates ?? []) inside(q[0], `${name} plaque`);
        for (const q of m.texts ?? []) inside(q[0], `${name} ${q[3]}`);
        if (m.lozenge) inside(m.lozenge.s, `${name} losange`);
      }
    }
  });

  it("Kebab Autun : mur de 30,7 m classé « cour » passé en rue, devanture au milieu (s 10 à 20,7)", () => {
    const f = fiche("25_35", "348854304"), d = f.ground.devanture!;
    expect(f.address).toContain("17bis");
    expect(f.walls[2]!.length).toBeCloseTo(30.7, 1);
    expect(d.s0).toBe(10);
    expect(width(d)).toBeCloseTo(10.7, 1);
    expect(d.modern!.texts!.some((q) => q[3] === "Kebab Autun")).toBe(true);
  });

  it("boutiques d'angle : Fleurs (mur 11 puis mur 10) et hôtel (mur 6 puis mur 7) partagent leur sommet", () => {
    const fl = fiche("25_35", "348854245");
    expect(fl.ground.front).toBe(11);
    expect(fl.ground.corner!.wall).toBe(10);
    near(ends("25_35", "348854245", 10).b, ends("25_35", "348854245", 11).a);
    expect(fl.ground.shops![0]!.terrace!.planters).toBe("boxes");
    expect(fl.ground.shops![0]!.terrace!.tables).toBe(false);
    expect(fl.ground.devanture!.awning).toBeDefined();
    expect(fl.ground.corner!.devanture.awning).toBeDefined();
    const ho = fiche("24_37", "348856297");
    expect(ho.ground.front).toBe(6);
    expect(ho.ground.corner!.wall).toBe(7);
    near(ends("24_37", "348856297", 6).b, ends("24_37", "348856297", 7).a);
    expect(ho.ground.corner!.devanture.modern!.tint).toBeDefined();
    expect(ho.ground.devanture!.modern!.canopy).toBeDefined();
    expect(ho.ground.shops![0]!.terrace!.parasol).toBe("none");
  });

  it("tabac : au bout du mur 8, City Kebab gardé, doublon du 22 avenue de la République retiré", () => {
    const f = fiche("24_37", "348856228"), d = f.ground.devanture!;
    expect(f.walls[8]!.length).toBeCloseTo(16.93, 1);
    expect(d.s0 + width(d)).toBeGreaterThan(f.walls[8]!.length - 0.1);
    expect(f.ground.shops!.some((s) => s.name === "City Kebab")).toBe(true);
    const count = tile("24_37").fiches.filter((x) => x.ground.shops?.some((s) => s.name === "Tabac Presse de la Gare")).length;
    expect(count).toBe(1);
    expect(d.modern!.lozenge).toBeDefined();
  });

  it("boucherie HN : bout nord-est de la bande de 42 m, La Poste gardée à l'autre bout", () => {
    const f = fiche("30_40", "348858747"), d = f.ground.devanture!;
    expect(f.walls[0]!.length).toBeCloseTo(42.18, 1);
    expect(d.s0).toBe(24);
    expect(f.ground.shops!.some((s) => s.name === "Autun Saint-Pantaléon")).toBe(true);
    expect(f.levels).toBe(1);
  });

  it("Emmaüs (12,3 m, bandeau bordeaux) et Morvan Pêche (13,5 m, passage de garage de 3,7 m)", () => {
    const e = fiche("25_36", "348856222");
    expect(e.walls[4]!.length).toBeCloseTo(12.32, 1);
    expect(width(e.ground.devanture!)).toBeCloseTo(12.32, 1);
    const mp = fiche("26_35", "348854022"), d = mp.ground.devanture!;
    expect(mp.walls[1]!.length).toBeCloseTo(13.52, 1);
    expect(d.bays.find((q) => q[0] === "passage")![1]).toBeCloseTo(3.7, 2);
    expect(d.modern!.texts!.some((q) => q[3] === "MORVAN PÊCHE")).toBe(true);
  });

  it("géométrie : sommets finis, coût borné, store et lettres ajoutent des triangles", () => {
    for (const [t, id, name] of SHOPS) {
      const f = fiche(t, id);
      for (const [d] of all(f)) {
        const mb = new MeshBuilder();
        buildDevanture(mb, null, null, frame, d, f.ground.shopfront!.color);
        expect(mb.positions.every(Number.isFinite), name).toBe(true);
        expect(mb.positions.length / 9, name).toBeLessThan(2500);
      }
    }
    const f = fiche("25_35", "348854245"), d = f.ground.devanture!;
    const [a, b] = [new MeshBuilder(), new MeshBuilder()];
    buildDevanture(a, null, null, frame, d, f.ground.shopfront!.color);
    buildDevanture(b, null, null, frame, { ...d, awning: undefined } as never, f.ground.shopfront!.color);
    expect(a.positions.length).toBeGreaterThan(b.positions.length);
  });
});
