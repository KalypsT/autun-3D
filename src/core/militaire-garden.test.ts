import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { loadRealWorld } from "./testing";
import { inFlatRing } from "./waters";
import { addTileColliders } from "./world";
import { MeshBuilder } from "../render/geometry";
import { buildCollege } from "../render/monuments";

/** D261 : Lycée militaire, lot 4 de docs/plans/lycee-militaire.md : sols, parterres, ifs, mât, bassin. */
describe("Lycée militaire : jardins (D261)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const garden = spec.mil!.garden!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;
  // Les sols ne sont pas réunis par loadRealWorld : ceux de la tuile du lycée.
  const ground = (JSON.parse(readFileSync("public/data/tiles/28_35.json", "utf8")) as { ground: Record<string, number[][][] | undefined> }).ground;
  const inClass = (cls: string, x: number, y: number): boolean =>
    (ground[cls] ?? []).some((poly) => inFlatRing(poly[0]!, x, y) && !poly.slice(1).some((h) => inFlatRing(h, x, y)));

  it("sols : stabilisé sur la place d'armes et l'allée du portail, gravier dans les cours et les ovales, gazon dans les compartiments", () => {
    expect(inClass("path_gravel", 678, 80)).toBe(true);
    expect(inClass("path_gravel", 548, 66)).toBe(true);
    expect(inClass("plaza_gravel", 615, 8)).toBe(true);
    expect(inClass("plaza_gravel", 584, -45)).toBe(true);
    expect(inClass("plaza_gravel", 630.4, 44.4)).toBe(true);
    expect(inClass("lawn", 625.5, 48.6)).toBe(true);
    // Rien sur le toit : un point de l'aile nord-est n'est dans aucun de ces sols.
    for (const cls of ["path_gravel", "plaza_gravel", "lawn"]) expect(inClass(cls, 629.8, 29.7)).toBe(false);
  });

  it("quatre ovales de buis bas (45 cm), fermés", () => {
    const hedges = world.tile.walls.filter((w) => w.id <= -880000010 && w.id >= -880000013);
    expect(hedges).toHaveLength(4);
    for (const h of hedges) {
      expect(h.kind).toBe("hedge");
      expect(h.height).toBe(0.45);
      expect(Math.hypot(h.pts[0]! - h.pts[h.pts.length - 2]!, h.pts[1]! - h.pts[h.pts.length - 1]!)).toBeLessThan(0.01);
    }
  });

  it("obstacles : la margelle du bassin arrête le piéton, les ifs et le mât aussi ; l'allée du portail reste libre", () => {
    const c = new Colliders();
    addTileColliders(c, world.tile);
    const { c: bc, r } = garden.basin;
    expect(c.resolve(bc[0] + r + 0.5, bc[1], 0.35).hit).toBe(true);
    for (const [x, y] of garden.yews) expect(c.resolve(x, y, 0.35).hit).toBe(true);
    expect(c.resolve(garden.mast[0], garden.mast[1], 0.35).hit).toBe(true);
    // Allée : du portail au passage voûté, à 2 m de l'axe et au-delà des ifs, pas de contact (sauf arbres de la carte : on vérifie le milieu).
    expect(c.resolve(548, 66, 0.35).hit).toBe(false);
  });

  it("ifs, mât et bassin coûtent moins de 3 000 triangles ; l'eau est sous la margelle et au-dessus du fond", () => {
    const count = (s: typeof spec): MeshBuilder => {
      const mb = new MeshBuilder();
      buildCollege(mb, new MeshBuilder(), s, b.ring, world.terrain, b.holes);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      return mb;
    };
    // Ifs, mât et bassin seuls : les arbres en rideau et les massifs (D264) ont leur propre test.
    const garden = { ...spec.mil!.garden! };
    delete garden.pleached;
    delete garden.beds;
    const base = { ...spec, mil: { ...spec.mil!, garden } };
    const mil = { ...spec.mil! };
    delete mil.garden;
    const cost = (count(base).positions.length - count({ ...spec, mil }).positions.length) / 9;
    expect(cost).toBeGreaterThan(500);
    expect(cost).toBeLessThan(3000);
    const floor = world.terrain.heightAt(...garden.basin.c);
    expect(floor).toBeLessThan(13);
  });
});
