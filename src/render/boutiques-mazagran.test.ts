import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D178 : boutiques de la rue Mazagran, du boulevard Mazagran et de la rue des Fusiliers Marins d'après photos (`fronts` de manual.json). */
const tiles = new Map<string, TileData>();
const fiche = (tile: string, id: string): FacadeFiche => {
  if (!tiles.has(tile)) tiles.set(tile, JSON.parse(readFileSync(`public/data/tiles/${tile}.json`, "utf8")) as TileData);
  return tiles.get(tile)!.fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
};
const SHOPS: [string, string, string, string][] = [
  ["26_36", "348856879", "Maison Benzaabar", "bakery"],
  ["26_36", "348856897", "Guinness Irish Pub", "pub"],
  ["26_37", "348848399", "Restaurant Les Remparts", "restaurant"],
  ["27_37", "348848405", "Point Plus le Marigny", "newsagent"],
  ["28_38", "348848798", "Festival des Pains", "bakery"],
];
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };

describe("boutiques de la rue Mazagran (D178)", () => {
  it("chaque boutique est vue sur photo, seule dans sa fiche, et sa devanture tient dans le mur d'entrée", () => {
    for (const [tile, id, name, kind] of SHOPS) {
      const f = fiche(tile, id);
      expect(f.status, name).toBe("observed");
      expect(f.ground.shops, name).toHaveLength(1);
      expect(f.ground.shops![0]!.name).toBe(name);
      expect(f.ground.shops![0]!.kind).toBe(kind);
      const d = f.ground.devanture!;
      const wall = f.walls[f.ground.front!]!;
      expect(wall.role).toBe("street");
      const width = d.bays.reduce((a, q) => a + q[1], 0);
      expect(d.s0, name).toBeGreaterThanOrEqual(0);
      expect(d.s0 + width, name).toBeLessThanOrEqual(wall.length + 0.01);
      expect(d.sill).toBeLessThan(d.top);
      expect(d.h).toBeLessThanOrEqual(f.storeys.ground + 0.7);
      expect(d.modern, name).toBeDefined();
    }
  });

  it("le pub n'est plus lié au bâtiment voisin, et les murs qui cachaient sa façade sont retirés", () => {
    expect(JSON.stringify(fiche("26_36", "348856901").ground.shops)).not.toContain("Irish");
    const ids = new Set(tiles.get("26_36")!.walls?.map((w) => w.id));
    expect(ids.has(-900008728)).toBe(false);
    expect(ids.has(-900008869)).toBe(false);
  });

  it("terrasses : estrade et barrière chez Benzaabar, bacs chez le pub (sans table) et aux Remparts", () => {
    const b = fiche("26_36", "348856879").ground.shops![0]!.terrace!;
    expect(b.planters).toBe("fence");
    expect(b.platform).toBeTruthy();
    const p = fiche("26_36", "348856897").ground.shops![0]!.terrace!;
    expect(p.planters).toBe("boxes");
    expect(p.tables).toBe(false);
    const r = fiche("26_37", "348848399").ground.shops![0]!.terrace!;
    expect(r.planters).toBe("boxes");
    expect(r.parasol).toBe("none");
    // Chaque terrasse tient dans la devanture.
    for (const [tile, id] of SHOPS.slice(0, 3)) {
      const f = fiche(tile, id);
      const d = f.ground.devanture!, t = f.ground.shops![0]!.terrace!;
      const width = d.bays.reduce((a, q) => a + q[1], 0);
      const [s0, s1] = t.span ?? [d.s0, d.s0 + width];
      expect(s0).toBeGreaterThanOrEqual(d.s0 - 0.01);
      expect(s1).toBeLessThanOrEqual(d.s0 + width + 0.01);
    }
  });

  it("stores : le pub (fanions, mot sur la pente) et Les Remparts (lambrequin lettré) ont le leur, dans l'emprise de la devanture", () => {
    for (const [tile, id] of [SHOPS[1]!, SHOPS[2]!]) {
      const f = fiche(tile, id);
      const d = f.ground.devanture!, a = d.awning!;
      const width = d.bays.reduce((q, w) => q + w[1], 0);
      expect(a.s[0]).toBeGreaterThanOrEqual(d.s0 - 0.01);
      expect(a.s[1]).toBeLessThanOrEqual(d.s0 + width + 0.01);
      expect(a.drop).toBeLessThan(a.z);
      expect(a.text).toBeTruthy();
    }
    expect(fiche("26_36", "348856897").ground.devanture!.awning!.bunting).toBe(true);
    expect(fiche("26_36", "348856897").ground.devanture!.awning!.top).toBe("GUINNESS");
  });

  it("Point Plus : losange « PRESSE » en drapeau, bandeau noir et logo ; cadres sombres chez le pub et les Remparts", () => {
    const m = fiche("27_37", "348848405").ground.devanture!.modern!;
    expect(m.lozenge).toBeDefined();
    expect(m.plates!.length).toBeGreaterThanOrEqual(2);
    expect(m.logos!.length).toBe(1);
    expect(fiche("26_36", "348856897").ground.devanture!.modern!.frame).toBe("#0f1412");
    expect(fiche("26_37", "348848399").ground.devanture!.modern!.frame).toBe("#39414a");
  });

  it("géométrie : sommets finis, coût borné ; le store ajoute des triangles ; le losange aussi", () => {
    for (const [tile, id, name] of SHOPS) {
      const f = fiche(tile, id);
      const d = f.ground.devanture!;
      const mb = new MeshBuilder(), glow = new MeshBuilder();
      buildDevanture(mb, glow, null, frame, d, f.ground.shopfront!.color);
      expect(mb.positions.every(Number.isFinite), name).toBe(true);
      expect(mb.positions.length / 9, name).toBeLessThan(2500);
      expect(glow.positions.length / 9, name).toBeGreaterThanOrEqual(2);
    }
    const f = fiche("26_36", "348856897");
    const d = f.ground.devanture!;
    const [a, b] = [new MeshBuilder(), new MeshBuilder()];
    buildDevanture(a, null, null, frame, d, f.ground.shopfront!.color);
    buildDevanture(b, null, null, frame, { ...d, awning: undefined } as never, f.ground.shopfront!.color);
    expect(a.positions.length).toBeGreaterThan(b.positions.length + 9 * 20);
    const g = fiche("27_37", "348848405");
    const [c, e] = [new MeshBuilder(), new MeshBuilder()];
    const dm = g.ground.devanture!;
    buildDevanture(c, null, null, frame, dm, g.ground.shopfront!.color);
    buildDevanture(e, null, null, frame, { ...dm, modern: { ...dm.modern!, lozenge: undefined } } as never, g.ground.shopfront!.color);
    expect(c.positions.length).toBeGreaterThan(e.positions.length);
  });
});
