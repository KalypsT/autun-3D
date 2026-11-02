import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { landmarkDecks } from "../core/landmarks";
import type { PassageSite } from "../data/types";
import { MeshBuilder } from "./geometry";
import { buildPassage } from "./passage";
import { BAYS, galleryRange } from "./passage-gallery";

/** D187, D188 : le sol, la volée, les linteaux et le décor de la galerie du passage Balthus. */
describe("rendu du passage Balthus", () => {
  const world = loadRealWorld();
  const site = world.tile.kinds!.sites.find((s): s is PassageSite => s.t === "passage")!;
  world.terrain.decks.add("passage", landmarkDecks(world.tile.kinds));
  const solid = new MeshBuilder(), glow = new MeshBuilder();
  buildPassage(solid, site, world.terrain, glow);
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

  it("rien ne dépasse du couloir : altitudes entre le sol et la verrière, largeur du couloir", () => {
    const zs: number[] = [];
    for (let i = 1; i < solid.positions.length; i += 3) zs.push(solid.positions[i]!);
    expect(Math.min(...zs)).toBeGreaterThan(site.zf - 0.5);
    // Linteaux compris (jusqu'à 22 m) ; la charpente de la galerie reste sous 15 m.
    expect(Math.max(...zs)).toBeLessThan(23);
  });
});
