import { describe, expect, it } from "vitest";
import { loadRealWorld } from "./testing";
import { buildColliders } from "./world";
import { landmarkDecks, PASSAGE_SLAB, passageFloor, passagePoint } from "./landmarks";
import type { PassageSite } from "../data/types";

/** D187 : le passage Balthus se traverse à pied de la rue Demetz à la rue aux Cordiers. */
describe("passage Balthus (D187)", () => {
  const world = loadRealWorld();
  const site = world.tile.kinds!.sites.find((s): s is PassageSite => s.t === "passage")!;
  const colliders = buildColliders(world.tile);
  world.terrain.decks.add("passage", landmarkDecks(world.tile.kinds));
  const ring = (id: string): number[] => world.tile.buildings.find((b) => b.id === id)!.ring;
  const inside = (r: number[], x: number, y: number): boolean => {
    let ins = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1]! > y !== r[j + 1]! > y && x < ((r[j]! - r[i]!) * (y - r[i + 1]!)) / (r[j + 1]! - r[i + 1]!) + r[i]!) ins = !ins;
    }
    return ins;
  };

  it("le site est dans les données, avec des niveaux mesurés", () => {
    expect(site).toBeTruthy();
    expect(site.L).toBeGreaterThan(60);
    expect(site.zf).toBeGreaterThan(3.8);
    expect(site.zf).toBeLessThan(4.2);
    expect(site.zc - site.zf).toBeGreaterThan(2.2);
    expect(site.zc - site.zf).toBeLessThan(2.7);
    expect(site.st[2]).toBe(15);
  });

  it("aucun bâtiment ne recouvre plus le couloir", () => {
    const ids = ["BATIMENT0000000348853287", "BATIMENT0000000348853288", "BATIMENT0000000348853543", "BATIMENT0000000348853545"];
    for (const id of ids) {
      for (let d = 0; d <= site.L; d += 0.5) {
        for (const t of [-2.3, 0, 2.3]) {
          const [x, y] = passagePoint(site, d, t);
          expect(inside(ring(id), x, y), `${id.slice(-4)} à ${d} m, t = ${t}`).toBe(false);
        }
      }
    }
  });

  it("on traverse d'un bout à l'autre sans rien heurter", () => {
    for (let d = -3; d <= site.L + 3; d += 0.25) {
      const [x, y] = passagePoint(site, d, 0);
      expect(colliders.resolve(x, y, 0.35).hit, `à ${d} m`).toBe(false);
    }
  });

  it("les murs du couloir restent des obstacles", () => {
    for (const d of [5, 15, 25, 35, 45, 58]) {
      for (const t of [-2.7, 2.7]) {
        const [x, y] = passagePoint(site, d, t);
        expect(colliders.resolve(x, y, 0.35).hit, `à ${d} m, t = ${t}`).toBe(true);
      }
    }
  });

  it("le sol suit le niveau mesuré : galerie plate, volée, palier de la rue aux Cordiers", () => {
    const z = (d: number, t = 0): number => {
      const [x, y] = passagePoint(site, d, t);
      return world.terrain.heightAt(x, y);
    };
    // Le relief interpolé sous les bâtiments bombait le sol vers les murs : il est aplani (build_passage.py).
    for (const d of [8, 20, 32, 44]) for (const t of [-2.4, -1.2, 1.2, 2.4]) expect(Math.abs(z(d, t) - site.zf - PASSAGE_SLAB), `à ${d} m, t = ${t}`).toBeLessThan(0.05);
    for (const d of [12, 25, 40]) expect(z(d)).toBeCloseTo(site.zf + PASSAGE_SLAB, 2);
    for (const d of [49, 52, 56, 62]) expect(z(d), `à ${d} m`).toBeGreaterThanOrEqual(passageFloor(site, d) - 0.05);
    expect(z(60)).toBeCloseTo(site.zc, 1);
    expect(passageFloor(site, 0)).toBeCloseTo(site.zf + PASSAGE_SLAB, 5);
    expect(passageFloor(site, site.L)).toBe(site.zc);
  });

  it("les linteaux couvrent les deux bouts, sans trou, au-dessus de la tête", () => {
    const sorted = [...site.lin].sort((a, b) => a[0] - b[0]);
    expect(sorted[0]![0]).toBe(0);
    expect(sorted[sorted.length - 1]![1]).toBeGreaterThan(site.L - 0.5);
    for (const [d0, d1, z0, z1] of sorted) {
      expect(d1).toBeGreaterThan(d0);
      expect(z0 - passageFloor(site, d1)).toBeGreaterThanOrEqual(3.5);
      expect(z1).toBeGreaterThan(z0);
    }
  });
});
