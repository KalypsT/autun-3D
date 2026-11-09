import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { croixAt, croixCircles, croixFrame, croixPits, croixRings, croixUT, inCroix, landmarkRings, treesOutsideMonuments } from "../core/landmarks";
import { loadRealNav, loadRealWorld } from "../core/testing";
import type { CroixSite } from "../data/types";
import { MeshBuilder } from "./geometry";
import { buildCroix } from "./croix";

// La Croix de la Libération (D267, docs/plans/croix-liberation.md) : mesures du LiDAR, relief remodelé, obstacles, abords, modèle.
const world = loadRealWorld();
const site = world.tile.kinds!.sites.find((q): q is CroixSite => q.t === "croix")!;

describe("Croix de la Libération (D267)", () => {
  it("mesures : axe au point OpenStreetMap, bras au cap 125°, 10 m au-dessus de la plate-forme, dessus au niveau du parking", () => {
    expect(site).toBeDefined();
    expect(Math.hypot(site.c[0] + 840.4, site.c[1] + 1808.7)).toBeLessThan(1.5);
    const cap = (90 - (site.a * 180) / Math.PI + 360) % 360;
    expect(Math.abs(cap - 125)).toBeLessThan(5);
    expect(site.top).toBeGreaterThan(9.5);
    expect(site.top).toBeLessThan(10.7);
    expect(site.g + 330).toBeGreaterThan(588.5);
    expect(site.g + 330).toBeLessThan(590);
    // Bras : 3,5 à 5 m d'envergure, plus larges que le fût, sous la tête.
    expect(site.arms.span).toBeGreaterThan(3.5);
    expect(site.arms.span).toBeLessThan(5);
    expect(site.arms.z[1]).toBeLessThan(site.top - 1);
    // Plate-forme : 6 à 8 m de côté sur le dessus, mur nord de 1 à 1,4 m.
    const [u0, u1, t0, t1] = site.deck;
    expect(u1 - u0).toBeGreaterThan(5.5);
    expect(u1 - u0).toBeLessThan(8);
    expect(t1 - t0).toBeGreaterThan(6.5);
    expect(t1 - t0).toBeLessThan(9);
    expect(site.drop.n).toBeGreaterThan(0.9);
    expect(site.drop.n).toBeLessThan(1.5);
  });

  it("relief : le dessus est plat, le mur nord est une marche franche, pas de rampe devant lui", () => {
    const [u0, u1, t0, t1] = site.deck;
    for (const u of [u0 + 0.6, (u0 + u1) / 2, u1 - 0.6]) {
      for (const t of [t0 + 0.6, 0, t1 - 2.2]) {
        const [x, y] = croixAt(site, u, t);
        expect(Math.abs(world.terrain.heightAt(x, y) - site.g)).toBeLessThan(0.1);
      }
    }
    // Entre les escaliers, 1,5 m devant le mur : au moins 80 cm sous le dessus (le MNT y faisait une rampe).
    const [x, y] = croixAt(site, (site.stairs.u[0]![1] + site.stairs.u[1]![0]) / 2, t1 + 1.5);
    expect(world.terrain.heightAt(x, y)).toBeLessThan(site.g - 0.8);
    // Creux d'affichage : le relief affiché passe sous toute la plate-forme, pas au-delà.
    const pits = croixPits(world.tile.kinds);
    expect(pits.length).toBe(1);
    const [cx, cy] = croixAt(site, 0, 0);
    expect(pits[0]!.cap(cx, cy)).toBeLessThan(site.g - 1);
    const [ox, oy] = croixAt(site, 0, t1 + 1);
    expect(pits[0]!.cap(ox, oy)).toBe(Infinity);
  });

  it("obstacles : on bute sur la marche du fût et sur le mur nord, on monte par les escaliers et les talus ; mâts et rochers dehors", () => {
    const c = new Colliders();
    for (const r of landmarkRings({ sites: [site] }, () => 0)) c.addRing(r);
    expect(croixRings(site).length).toBeGreaterThanOrEqual(6);
    expect(c.resolve(...croixAt(site, site.plinth.u[1] + 0.2, 0), 0.35).hit).toBe(true);
    const t1 = site.deck[3];
    expect(c.resolve(...croixAt(site, 0.2, t1 + 0.3), 0.35).hit).toBe(true);
    // Milieu de chaque escalier, et milieu du talus sud : libres.
    for (const [a, b] of site.stairs.u) expect(c.resolve(...croixAt(site, (a + b) / 2, t1 - site.stairs.run / 2), 0.35).hit).toBe(false);
    expect(c.resolve(...croixAt(site, 0.25, site.deck[2] - site.talus.s / 2), 0.35).hit).toBe(false);
    for (const [x, y, r] of croixCircles(site)) expect(inCroix(site, x, y, -r)).toBe(false);
  });

  it("abords : aucun arbre sur la plate-forme, aucune file piétonne à travers ses obstacles, un point « monument » devant", () => {
    const trees = treesOutsideMonuments(world.tile.kinds, world.tile.trees);
    for (const [x, y] of trees) expect(inCroix(site, x, y)).toBe(false);
    const rings = croixRings(site);
    const inside = (x: number, y: number): boolean => rings.some((r) => {
      let k = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
        if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) k = !k;
      }
      return k;
    });
    const { cells } = loadRealNav();
    let near = 0, memorial = false;
    for (const cell of cells) {
      const [bx0, by0, bx1, by1] = cell.bounds;
      if (site.c[0] < bx0 - 100 || site.c[0] > bx1 + 100 || site.c[1] < by0 - 100 || site.c[1] > by1 + 100) continue;
      const g = cell.ped;
      for (let e = 0; e < g.edges; e++) {
        const pts: number[] = [g.nodeX[g.a[e]!]!, g.nodeY[g.a[e]!]!];
        for (let j = 0; j < g.np[e]!; j++) pts.push(g.geom[2 * (g.p0[e]! + j)]!, g.geom[2 * (g.p0[e]! + j) + 1]!);
        pts.push(g.nodeX[g.b[e]!]!, g.nodeY[g.b[e]!]!);
        for (let k = 0; k + 3 < pts.length; k += 2) {
          for (let s = 0; s <= 10; s++) {
            const x = pts[k]! + ((pts[k + 2]! - pts[k]!) * s) / 10, y = pts[k + 1]! + ((pts[k + 3]! - pts[k + 1]!) * s) / 10;
            expect(inside(x, y)).toBe(false);
            if (Math.hypot(x - site.c[0], y - site.c[1]) < 25) near++;
          }
        }
      }
      for (let i = 0; i < cell.poi.count; i++) {
        if (cell.poi.kind[i] !== 8) continue;
        const [u, t] = croixUT(site, cell.poi.x[i]!, cell.poi.y[i]!);
        if (Math.abs(u) < 4 && t < site.deck[2] - site.talus.s && t > site.deck[2] - site.talus.s - 3) memorial = true;
      }
    }
    expect(near).toBeGreaterThan(0);
    expect(memorial).toBe(true);
  });

  it("modèle : sommets finis, sommet de la croix au sommet mesuré, moins de 4 000 triangles, éclairé la nuit", () => {
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildCroix(mb, glow, site, world.terrain);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    const tris = mb.positions.length / 9;
    expect(tris).toBeLessThan(4000);
    let top = -Infinity;
    for (let i = 1; i < mb.positions.length; i += 3) top = Math.max(top, mb.positions[i]!);
    expect(Math.abs(top - (site.g + site.top))).toBeLessThan(0.05);
    expect(glow.positions.length / 9).toBeGreaterThan(50);
    expect(glow.positions.length / 9).toBeLessThan(tris);
    // D300 : la face de la croix tournée vers le parking (côté −t, à l'opposé des mâts) prend la lumière du projecteur au sol.
    const f = croixFrame(site), nx = -f.vx, nz = f.vy;
    let lit = 0;
    for (let i = 0; i < glow.alphas!.length; i++) {
      const facing = glow.normals[3 * i]! * nx + glow.normals[3 * i + 2]! * nz > 0.9;
      if (facing && glow.positions[3 * i + 1]! > site.g + 3 && glow.alphas![i]! > 0.3) lit++;
    }
    expect(lit).toBeGreaterThan(20);
  });
});
