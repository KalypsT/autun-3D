import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Devanture, FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D181 et D182 : Saigon, tabac, Crédit Agricole, cordonnerie, Le Faro, pâtisserie d'Aurélien et Optic 2000 (façade courbe) d'après photos. */
const tiles = new Map<string, TileData>();
const fiche = (tile: string, id: string): FacadeFiche => {
  if (!tiles.has(tile)) tiles.set(tile, JSON.parse(readFileSync(`public/data/tiles/${tile}.json`, "utf8")) as TileData);
  return tiles.get(tile)!.fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
};
const SHOPS: [string, string, string, string][] = [
  ["26_36", "348856847", "Restaurant Saigon", "restaurant"],
  ["26_36", "348854366", "Tabac Cadeaux", "tobacco"],
  ["26_35", "348854348", "Crédit Agricole", "bank"],
  ["26_35", "348854372", "Cordonnerie Multiservices", "shoe_repair"],
  ["26_35", "348854049", "Le Faro", "bar"],
  ["26_36", "348856865", "Les Gourmandises d'Aurélien", "pastry"],
  ["26_34", "348853987", "Optic 2000", "optician"],
];
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
const width = (d: Devanture): number => d.bays.reduce((a, q) => a + q[1], 0);

describe("boutiques d'après photos, lots D181 et D182", () => {
  it("chaque boutique est vue sur photo, nommée, et sa devanture tient dans son mur de rue", () => {
    for (const [tile, id, name, kind] of SHOPS) {
      const f = fiche(tile, id);
      expect(f.status, name).toBe("observed");
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

  it("emplacements : tabac au n° 1 (6 m), Le Faro sur la place (6,6 m, face à l'ouest), pâtisserie dans l'îlot (face à l'est)", () => {
    expect(fiche("26_36", "348854366").address).toContain("1 Rue Guérin");
    const faro = fiche("26_35", "348854049");
    expect(faro.address).toContain("18 Rue");
    expect(faro.walls[faro.ground.front!]!.length).toBeCloseTo(6.64, 1);
    expect(fiche("26_36", "348856865").address).toContain("15 Rue Guérin");
    expect(faro.ground.shops![0]!.terrace).toBeDefined();
    expect(faro.levels).toBe(3);
  });

  it("stores lettrés : pâtisserie (nom des gérants), Le Faro (store blanc)", () => {
    expect(fiche("26_36", "348856865").ground.devanture!.awning!.text).toContain("Virginie");
    expect(fiche("26_35", "348854049").ground.devanture!.awning).toBeDefined();
  });

  it("Optic 2000 : façade courbe, une devanture par mur consécutif du coin, bandeau continu", () => {
    const f = fiche("26_34", "348853987");
    expect(f.ground.front).toBe(1);
    const chain = f.ground.corners!.map((c) => c.wall);
    expect(chain).toEqual([2, 3, 4, 5, 6, 7]);
    // Chaque mur suit le précédent dans le contour : la fin de l'un est le début de l'autre.
    let prev = f.walls[1]!;
    for (const c of f.ground.corners!) {
      const w = f.walls[c.wall]!;
      expect(w.a, `mur ${c.wall}`).toBe(prev.b);
      expect(w.role).toBe("street");
      expect(c.devanture.s0 + width(c.devanture)).toBeLessThanOrEqual(w.length + 0.01);
      prev = w;
    }
    // Bandeau de même couleur et de même hauteur sur tous les murs.
    const bands = [f.ground.devanture!, ...f.ground.corners!.map((c) => c.devanture)].map((d) => d.modern!.plates![0]!);
    for (const b of bands) {
      expect(b[1]).toBe(2.85);
      expect(b[2]).toBe(3.4);
      expect(b[4]).toBe(bands[0]![4]);
    }
    // Le voisin « Le Gourmet » n'est pas perdu.
    expect(f.ground.shops!.some((s) => s.name === "Le Gourmet")).toBe(true);
  });

  it("géométrie : sommets finis, coût borné, store et lettres ajoutent des triangles", () => {
    for (const [tile, id, name] of SHOPS) {
      const f = fiche(tile, id);
      const ds = [f.ground.devanture!, ...(f.ground.corners ?? []).map((c) => c.devanture)];
      for (const d of ds) {
        const mb = new MeshBuilder();
        buildDevanture(mb, null, null, frame, d, f.ground.shopfront!.color);
        expect(mb.positions.every(Number.isFinite), name).toBe(true);
        expect(mb.positions.length / 9, name).toBeLessThan(2500);
      }
    }
    const f = fiche("26_36", "348856865"), d = f.ground.devanture!;
    const [a, b] = [new MeshBuilder(), new MeshBuilder()];
    buildDevanture(a, null, null, frame, d, f.ground.shopfront!.color);
    buildDevanture(b, null, null, frame, { ...d, awning: undefined } as never, f.ground.shopfront!.color);
    expect(a.positions.length).toBeGreaterThan(b.positions.length);
  });
});
