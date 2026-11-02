import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { landmarkDecks, PASSAGE_DOG, passagePoint } from "../core/landmarks";
import { buildColliders } from "../core/world";
import type { PassageSite } from "../data/types";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildPassage } from "./passage";
import { BAYS, galleryRange } from "./passage-gallery";

/** D187, D188 : le sol, la volée, les linteaux et le décor de la galerie du passage Balthus. */
describe("rendu du passage Balthus", () => {
  const world = loadRealWorld();
  const site = world.tile.kinds!.sites.find((s): s is PassageSite => s.t === "passage")!;
  world.terrain.decks.add("passage", landmarkDecks(world.tile.kinds));
  const texts: string[] = [];
  const atlas = { get: (text: string) => { texts.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
  buildPassage(sinks, site, world.terrain);
  const { solid, glow } = sinks;
  const tris = (m: MeshBuilder): number => m.positions.length / 9;

  it("la galerie va d'un linteau à l'autre", () => {
    const [g0, g1] = galleryRange(site);
    expect(g0).toBeGreaterThanOrEqual(7);
    expect(g0).toBeLessThanOrEqual(9);
    expect(g1).toBeGreaterThan(45);
    expect(g1).toBeLessThan(47);
    expect((g1 - g0) / BAYS).toBeGreaterThan(2.7);
    expect((g1 - g0) / BAYS).toBeLessThan(3.2);
  });

  it("géométrie finie, coût borné, globes allumés", () => {
    for (const m of [solid, glow]) for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
    expect(tris(solid)).toBeGreaterThan(2000);
    expect(tris(solid)).toBeLessThan(9000);
    expect(tris(glow)).toBeGreaterThan(2 * (BAYS + 1) * 8);
  });

  it("la plaque de la rue aux Cordiers et celle du chien sont écrites", () => {
    expect(texts).toContain("PASSAGE");
    expect(texts).toContain("BALTHUS");
    expect(texts.some((t) => t.includes("LATOUCHE"))).toBe(true);
    expect(texts).toContain("BRIARD");
    expect(sinks.names.positions.every(Number.isFinite)).toBe(true);
  });

  it("le chien est un obstacle au milieu de la galerie", () => {
    const colliders = buildColliders(world.tile);
    const [x, y] = passagePoint(site, PASSAGE_DOG.s, PASSAGE_DOG.t);
    expect(colliders.resolve(x, y, 0.3).hit).toBe(true);
    const [gx, gy] = passagePoint(site, PASSAGE_DOG.s, 1.2);
    expect(colliders.resolve(gx, gy, 0.3).hit).toBe(false);
  }, 30000);

  it("rien ne dépasse du couloir : altitudes entre le sol et la verrière, largeur du couloir", () => {
    const zs: number[] = [];
    for (let i = 1; i < solid.positions.length; i += 3) zs.push(solid.positions[i]!);
    expect(Math.min(...zs)).toBeGreaterThan(site.zf - 0.5);
    // Linteaux compris (jusqu'à 22 m) ; la charpente de la galerie reste sous 15 m.
    expect(Math.max(...zs)).toBeLessThan(23);
  });
});

describe("grilles fermées du passage Balthus (D190)", () => {
  it("un maillage fini de quelques centaines de triangles, du sol au sommet des pointes", async () => {
    const { buildPassageGates } = await import("./passage-gate");
    const geo = buildPassageGates();
    const p = geo.getAttribute("position");
    expect(p.count / 3).toBeGreaterThan(300);
    expect(p.count / 3).toBeLessThan(2500);
    let ys = 0, ok = true;
    for (let i = 0; i < p.count; i++) { ys = Math.max(ys, p.getY(i)); ok &&= Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)); }
    expect(ok).toBe(true);
    expect(ys).toBeGreaterThan(9);
  });
});
