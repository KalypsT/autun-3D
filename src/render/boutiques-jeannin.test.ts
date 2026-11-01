import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Devanture, FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D183 : rue Jeannin (Le Châteaubriant, boulangerie Benzaabar), avenue de Gaulle (Le Cyrano, Premier Immobilier, Surplus Eduen, BNP Paribas), rue Guérin (Jardin d'Intérieur, Aux trésors des dines). */
const tiles = new Map<string, TileData>();
const tile = (t: string): TileData => {
  if (!tiles.has(t)) tiles.set(t, JSON.parse(readFileSync(`public/data/tiles/${t}.json`, "utf8")) as TileData);
  return tiles.get(t)!;
};
const fiche = (t: string, id: string): FacadeFiche => tile(t).fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
/** Coordonnées du début (`a`) et de la fin (`b`) d'un mur du contour. */
const ends = (t: string, id: string, wall: number): { a: [number, number]; b: [number, number] } => {
  const ring = tile(t).buildings.find((b) => b.id === `BATIMENT0000000${id}`)!.ring;
  const w = fiche(t, id).walls[wall]!;
  return { a: [ring[2 * w.a]!, ring[2 * w.a + 1]!], b: [ring[2 * w.b]!, ring[2 * w.b + 1]!] };
};
const SHOPS: [string, string, string, string][] = [
  ["25_35", "348854275", "Le Châteaubriant", "restaurant"],
  ["25_35", "348854277", "Maison Benzaabar", "bakery"],
  ["25_35", "348854312", "Le Cyrano", "tobacco"],
  ["25_35", "348854313", "Agence Premier Immobilier", "estate_agent"],
  ["25_35", "348852378", "Surplus Eduen", "second_hand"],
  ["25_35", "348852379", "BNP Paribas", "bank"],
  ["26_36", "348854265", "Jardin d'Intérieur", "interior_decoration"],
  ["26_36", "348854266", "Aux trésors des dines", "clothes"],
];
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
const width = (d: Devanture): number => d.bays.reduce((a, q) => a + q[1], 0);
const near = (p: [number, number], q: [number, number]): void => {
  expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.06);
};

describe("boutiques d'après photos, lot D183", () => {
  it("chaque boutique est vue sur photo, nommée, et sa devanture tient dans son mur de rue", () => {
    for (const [t, id, name, kind] of SHOPS) {
      const f = fiche(t, id);
      expect(f.status, name).toBe("observed");
      expect(f.ground.shops, name).toHaveLength(1);
      expect(f.ground.shops![0]!.name).toBe(name);
      expect(f.ground.shops![0]!.kind).toBe(kind);
      const d = f.ground.devanture!, wall = f.walls[f.ground.front!]!;
      expect(wall.role, name).toBe("street");
      expect(d.s0).toBeGreaterThanOrEqual(0);
      expect(d.s0 + width(d), name).toBeLessThanOrEqual(wall.length + 0.01);
      expect(d.sill).toBeLessThan(d.top);
      expect(d.h).toBeLessThanOrEqual(f.storeys.ground + 0.7);
    }
  });

  it("voisins : les devantures se suivent dans le même ordre que les murs (fin de l'un = début du suivant)", () => {
    // Rue Jeannin : le restaurant (mur 10) puis la boulangerie (mur 0), de gauche à droite.
    near(ends("25_35", "348854275", 10).b, ends("25_35", "348854277", 0).a);
    // Avenue de Gaulle : Surplus Eduen (mur 7) puis BNP Paribas (mur 7) ; Le Cyrano (mur 3) puis Premier Immobilier (mur 1).
    near(ends("25_35", "348852378", 7).b, ends("25_35", "348852379", 7).a);
    near(ends("25_35", "348854312", 3).b, ends("25_35", "348854313", 1).a);
    // Rue Guérin : Jardin d'Intérieur (mur 0) puis Aux trésors des dines (mur 4).
    near(ends("26_36", "348854265", 0).b, ends("26_36", "348854266", 4).a);
  });

  it("les doublons d'OpenStreetMap sont retirés : Le Cyrano et Jardin d'Intérieur n'ont plus qu'une fiche", () => {
    const count = (t: string, name: string): number => tile(t).fiches.filter((f) => f.ground.shops?.some((s) => s.name === name)).length;
    expect(count("25_35", "Le Cyrano")).toBe(1);
    expect(count("26_36", "Jardin d'Intérieur")).toBe(1);
    expect(count("26_36", "Aux trésors des dines")).toBe(1);
  });

  it("restaurant : mur de 9,1 m, quatre baies et la porte cochère à droite, store lettré, terrasse sans parasol", () => {
    const f = fiche("25_35", "348854275"), d = f.ground.devanture!;
    expect(f.walls[10]!.length).toBeCloseTo(9.1, 1);
    expect(width(d)).toBeCloseTo(9.1, 1);
    expect(d.bays.at(-1)![0]).toBe("door");
    expect(d.bays.filter((q) => q[0] === "shopdoor")).toHaveLength(1);
    expect(d.modern!.plates!.length).toBe(4);
    expect(d.awning!.text).toContain("Chateaubriant");
    const t = f.ground.shops![0]!.terrace!;
    expect(t.planters).toBe("fence");
    expect(t.parasol).toBe("none");
  });

  it("boulangerie : terrasse à barrière verte, store blanc posé sous le bandeau, enseigne en texte posé", () => {
    const f = fiche("25_35", "348854277"), d = f.ground.devanture!;
    expect(f.walls[0]!.length).toBeCloseTo(8.12, 1);
    expect(f.ground.shops![0]!.terrace!.planters).toBe("fence");
    const band = d.modern!.plates![0]!;
    expect(d.awning!.z).toBeLessThanOrEqual(band[1]);
    expect(d.modern!.texts!.some((q) => q[3] === "Artisan Boulanger")).toBe(true);
  });

  it("Surplus Eduen : passage couvert de 2,5 m entre deux banderoles, bandeau blanc lettré", () => {
    const f = fiche("25_35", "348852378"), d = f.ground.devanture!;
    expect(f.walls[7]!.length).toBeCloseTo(4.91, 1);
    expect(d.bays.find((q) => q[0] === "passage")![1]).toBeCloseTo(2.47, 2);
    expect(d.modern!.plates!.length).toBe(3);
    expect(d.modern!.texts!.some((q) => q[3] === "SURPLUS EDUEN")).toBe(true);
    expect(f.materials.wall.kind).toBe("rubble");
  });

  it("Le Cyrano (auvent bordeaux lettré, carotte), Premier Immobilier (porte verte), BNP (logo vert)", () => {
    expect(fiche("25_35", "348854312").ground.devanture!.awning!.text).toContain("CYRANO");
    expect(fiche("25_35", "348854312").ground.devanture!.modern!.lozenge).toBeDefined();
    expect(fiche("25_35", "348854313").ground.devanture!.bays.some((q) => q[0] === "door")).toBe(true);
    const bnp = fiche("25_35", "348852379");
    expect(bnp.ground.devanture!.modern!.texts!.some((q) => q[3] === "BNP PARIBAS")).toBe(true);
    expect(width(bnp.ground.devanture!)).toBeLessThan(bnp.walls[7]!.length);
  });

  it("rue Guérin : Jardin d'Intérieur et Aux trésors des dines côte à côte, enseignes en texte posé", () => {
    const j = fiche("26_36", "348854265").ground.devanture!, a = fiche("26_36", "348854266").ground.devanture!;
    expect(j.modern!.texts!.some((q) => q[3] === "Jardin d'Intérieur")).toBe(true);
    expect(a.modern!.texts!.some((q) => q[3] === "Aux trésors des dines")).toBe(true);
    expect(fiche("26_36", "348854266").facade.balcony).toBe("filant");
  });

  it("géométrie : sommets finis, coût borné, store et lettres ajoutent des triangles", () => {
    for (const [t, id, name] of SHOPS) {
      const f = fiche(t, id);
      const mb = new MeshBuilder();
      buildDevanture(mb, null, null, frame, f.ground.devanture!, f.ground.shopfront!.color);
      expect(mb.positions.every(Number.isFinite), name).toBe(true);
      expect(mb.positions.length / 9, name).toBeLessThan(2500);
    }
    const f = fiche("25_35", "348854275"), d = f.ground.devanture!;
    const [a, b] = [new MeshBuilder(), new MeshBuilder()];
    buildDevanture(a, null, null, frame, d, f.ground.shopfront!.color);
    buildDevanture(b, null, null, frame, { ...d, awning: undefined } as never, f.ground.shopfront!.color);
    expect(a.positions.length).toBeGreaterThan(b.positions.length);
  });
});
