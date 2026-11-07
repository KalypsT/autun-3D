import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import type { CollegeWing, LodBuilding } from "../data/types";
import { MeshBuilder } from "./geometry";
import { buildCollege } from "./monuments";

/** D258 : Lycée militaire, lot 1 de docs/plans/lycee-militaire.md : volumes et toits relevés au LiDAR (§3.1), tuiles vernissées, cour d'honneur. */
describe("Lycée militaire : volumes et toits (D258)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;
  const wing = (name: string): CollegeWing => spec.wings[["pavillon nord", "pavillon ouest", "aile nord-est", "aile sud-ouest", "aile sud-est", "galerie nord-ouest"].indexOf(name)]!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;
  const top = (mb: MeshBuilder): number => {
    let z = -Infinity;
    for (let i = 1; i < mb.positions.length; i += 3) z = Math.max(z, mb.positions[i]!);
    return z;
  };

  it("trois grandes ailes à 36,2 m (± 0,5), deux pavillons plus hauts de 1,5 m au moins, galerie et cloître plats vers 22 m", () => {
    expect(spec.wings).toHaveLength(14);
    for (const n of ["aile nord-est", "aile sud-ouest", "aile sud-est"]) {
      expect(wing(n).r).toBeGreaterThan(35.7);
      expect(wing(n).r).toBeLessThan(36.9);
      expect(wing(n).g).toBe(1);
      // Égouts : 14 m au-dessus du sol de la cour (16,4 m), à 1,5 m près.
      for (const e of [wing(n).el, wing(n).er]) expect(Math.abs(e - 30.6)).toBeLessThan(1.5);
    }
    for (const n of ["pavillon nord", "pavillon ouest"]) expect(wing(n).r).toBeGreaterThan(wing("aile nord-est").r + 1.5);
    for (const w of spec.wings.filter((q) => q.c === "#8c8e8a")) {
      expect(w.r).toBe(w.el);
      expect(w.r).toBe(w.er);
      expect(Math.abs(w.r - 22)).toBeLessThan(0.8);
    }
  });

  it("les murs sur cour montent du toit du cloître à l'égout, du bon côté de leur aile", () => {
    for (const n of ["aile nord-est", "aile sud-est"]) expect(wing(n).ir?.[0]).toBeLessThan(21.8);
    expect(wing("aile sud-ouest").il?.[0]).toBeLessThan(21.8);
    // La façade sur cour de l'aile sud-est s'arrête à l'aile sud-ouest (au-delà, c'est le mur du contour, depuis le sol).
    const se = wing("aile sud-est"), L = Math.hypot(se.q[0] - se.p[0], se.q[1] - se.p[1]);
    expect(se.ir![2]).toBeLessThan(L - 20);
  });

  it("géométrie finie, sommet au faîtage du pavillon ouest, moins de 24 000 triangles, fenêtres allumées la nuit", () => {
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildCollege(mb, glow, spec, b.ring, world.terrain, b.holes);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(top(mb)).toBeGreaterThan(wing("pavillon ouest").r - 0.2);
    expect(top(mb)).toBeLessThan(wing("pavillon ouest").r + 0.2);
    // Plafond relevé de 20 000 à 24 000 en D264 (arbres en rideau et massifs, qui remplacent des arbres génériques).
    expect(tris(mb)).toBeLessThan(24000);
    expect(tris(glow)).toBeGreaterThan(0);
  });

  it("la cour d'honneur et la cour sud-ouest ont leurs murs ; les tuiles vernissées coûtent moins de 8 000 triangles", () => {
    const count = (holes: number[][], glazed: boolean): number => {
      const mb = new MeshBuilder();
      buildCollege(mb, new MeshBuilder(), { ...spec, wings: spec.wings.map((w) => {
        if (glazed) return w;
        const rest = { ...w };
        delete rest.g;
        return rest;
      }) }, b.ring, world.terrain, holes);
      return tris(mb);
    };
    expect(b.holes).toHaveLength(2);
    expect(count(b.holes, true) - count([], true)).toBeGreaterThan(200);
    const glaze = count(b.holes, true) - count(b.holes, false);
    expect(glaze).toBeGreaterThan(2000);
    expect(glaze).toBeLessThan(8000);
  });

  it("la silhouette lointaine a un prisme par aile, au faîtage mesuré", () => {
    const lod = JSON.parse(readFileSync("public/data/lod/28_35.json", "utf8")) as LodBuilding[];
    const ridges = lod.filter((q) => q.g > 35).map((q) => q.g);
    expect(ridges).toHaveLength(5);
    expect(Math.max(...ridges)).toBeCloseTo(wing("pavillon ouest").r, 0);
  });
});

/** D259 : Lycée militaire, lot 2 de docs/plans/lycee-militaire.md : façades d'après la photo 1 et le LiDAR. */
describe("Lycée militaire : façades (D259)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const mil = spec.mil!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;
  const tris = (s: typeof spec): number => {
    const mb = new MeshBuilder();
    buildCollege(mb, new MeshBuilder(), s, b.ring, world.terrain, b.holes);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    return mb.positions.length / 9;
  };

  it("le passage voûté est sur la façade extérieure de la galerie, sur l'axe du grand portail", () => {
    const [px, py] = mil.gallery.portal;
    const ring = b.ring, n = ring.length / 2;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const ax = ring[2 * i]!, ay = ring[2 * i + 1]!, bx = ring[2 * ((i + 1) % n)]!, by = ring[2 * ((i + 1) % n) + 1]!;
      const L = Math.hypot(bx - ax, by - ay), u = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L;
      if (u > 0 && u < L) best = Math.min(best, Math.abs(((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / L));
    }
    expect(best).toBeLessThan(0.3);
    // L'axe va du grand portail (505,5 ; 106,2) au milieu de l'aile sud-est : le passage est à moins de 0,5 m de cette droite.
    const [ox, oy, tx, ty] = [505.5, 106.2, 633.0, -13.5], L = Math.hypot(tx - ox, ty - oy);
    expect(Math.abs(((px - ox) * (ty - oy) - (py - oy) * (tx - ox)) / L)).toBeLessThan(0.5);
  });

  it("l'horloge est sur l'aile sud-est, côté cour, à moins de 1 m de l'axe ; les cheminées dépassent le faîtage de 1 à 2 m", () => {
    const w = spec.wings[mil.clock.w]!;
    const L = Math.hypot(w.q[0] - w.p[0], w.q[1] - w.p[1]);
    const cx = w.p[0] + ((w.q[0] - w.p[0]) * mil.clock.u) / L, cy = w.p[1] + ((w.q[1] - w.p[1]) * mil.clock.u) / L;
    // Axe : du grand portail au passage voûté ; il tombe sur la lucarne que le LiDAR voit au milieu du pan côté cour (u ≈ 30,9).
    const [ox, oy] = [505.5, 106.2], [tx, ty] = mil.gallery.portal, D = Math.hypot(tx - ox, ty - oy);
    expect(Math.abs(((cx - ox) * (ty - oy) - (cy - oy) * (tx - ox)) / D)).toBeLessThan(1);
    expect(mil.clock.left).toBe(false);
    expect(w.ir).toBeDefined();
    for (const [, , top] of mil.chim) {
      expect(top).toBeGreaterThan(36.2 + 1);
      expect(top).toBeLessThan(36.4 + 2);
    }
  });

  it("façades, lucarnes, balustrade, horloge et cheminées : entre 3 000 et 9 000 triangles ; le bâtiment reste sous 24 000", () => {
    const bare = { ...spec, wings: spec.wings.map((w) => {
      const r = { ...w };
      delete r.dl;
      delete r.dr;
      return r;
    }) };
    delete bare.mil;
    // Façades seules : sans les portails (D260) ni les jardins (D261), comptés par leurs propres tests.
    const facades = { ...spec.mil! };
    delete facades.gates;
    delete facades.garden;
    const full = tris(spec), cost = tris({ ...spec, mil: facades }) - tris(bare);
    expect(cost).toBeGreaterThan(3000);
    expect(cost).toBeLessThan(9000);
    expect(full).toBeLessThan(24000);
  });
});
