import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { at, bandstandRing, curtainTrunks, frameOf, furnitureOutsideMonuments, inCurtain, inMemorial, landmarkCircles, landmarkRings, memorialRing, treesOutsideMonuments } from "../core/landmarks";
import { CACHES } from "../core/pickups";
import { loadRealWorld } from "../core/testing";
import type { BandstandSite, CurtainSite, MemorialSite } from "../data/types";
import { MeshBuilder } from "./geometry";
import { buildBandstand, buildCurtain, buildMemorial } from "./square";

/** D155 : tilleuls en rideau et kiosque à musique de la place du Champ de Mars (tools/data/build_square.py). */
describe("place du Champ de Mars : tilleuls en rideau et kiosque (D155)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const curtains = kinds.sites.filter((s): s is CurtainSite => s.t === "curtain");
  const band = kinds.sites.find((s): s is BandstandSite => s.t === "bandstand")!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;

  it("six rideaux mesurés au LiDAR, tous le long de la rue Demetz, de 6,4 à 6,9 m de haut", () => {
    expect(curtains).toHaveLength(6);
    for (const s of curtains) {
      expect(s.l).toBeGreaterThan(19);
      expect(s.l).toBeLessThan(48);
      expect(s.w).toBeGreaterThan(8.5);
      expect(s.w).toBeLessThan(10.5);
      expect(s.top).toBeGreaterThan(6.3);
      expect(s.top).toBeLessThan(7.0);
      expect(s.fill).toBeGreaterThan(0.75);
      // Cap de la rue Demetz : 37,8°.
      expect(Math.abs((s.a * 180) / Math.PI - 37.8)).toBeLessThan(4);
      expect(s.trunk + s.crown).toBeLessThan(s.top + 0.2);
    }
  });

  it("les arbres génériques de la carte dans les rideaux ne sont plus dessinés ; leurs troncs sont des obstacles", () => {
    const inside = world.tile.trees.filter(([x, y]) => curtains.some((s) => inCurtain(s, x, y, 0.3)));
    expect(inside.length).toBeGreaterThanOrEqual(15);
    const shown = treesOutsideMonuments(kinds, world.tile.trees);
    for (const [x, y] of inside) expect(shown.some(([tx, ty]) => tx === x && ty === y)).toBe(false);
    const circles = landmarkCircles(kinds, world.tile.buildings);
    let n = 0;
    for (const s of curtains) for (const [x, y] of curtainTrunks(s)) {
      n++;
      expect(circles.some(([cx, cy, r]) => Math.abs(cx - x) < 1e-6 && Math.abs(cy - y) < 1e-6 && r === 0.25)).toBe(true);
    }
    expect(n).toBeGreaterThan(50);
    const c = new Colliders();
    for (const [x, y, r] of circles) c.addCircle(x, y, r);
    const [x, y] = curtainTrunks(curtains[0]!)[0]!;
    expect(c.resolve(x + 0.1, y, 0.3).hit).toBe(true);
  });

  it("deux files de troncs par rideau, à 4 m, toujours dans le rectangle", () => {
    for (const s of curtains) {
      const t = curtainTrunks(s);
      expect(t.length).toBe(2 * Math.round(s.l / s.pitch));
      for (const [x, y] of t) expect(inCurtain(s, x, y, -0.5)).toBe(true);
    }
  });

  it("passants : aucune file ne passe à moins de 30 cm d'un tronc", () => {
    const trunks = curtains.flatMap(curtainTrunks);
    for (const cell of ["s6_8", "s6_9"]) {
      const { n, e, g } = (JSON.parse(readFileSync(`public/data/nav/${cell}.json`, "utf8")) as { ped: { n: number[]; e: number[]; g: number[] } }).ped;
      for (let i = 0; i < e.length; i += 11) {
        const [a, b, , , , , , , , p0, np] = e.slice(i, i + 11) as number[];
        const pts: [number, number][] = [[n[3 * a!]!, n[3 * a! + 1]!]];
        for (let k = 0; k < np!; k++) pts.push([g[2 * (p0! + k)]!, g[2 * (p0! + k) + 1]!]);
        pts.push([n[3 * b!]!, n[3 * b! + 1]!]);
        for (let j = 0; j + 1 < pts.length; j++) {
          const [ax, ay] = pts[j]!, [bx, by] = pts[j + 1]!;
          const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
          for (let q = 0; q <= steps; q++) {
            const x = ax + ((bx - ax) * q) / steps, y = ay + ((by - ay) * q) / steps;
            for (const [tx, ty] of trunks) if (Math.hypot(x - tx, y - ty) < 0.55) throw new Error(`file à ${Math.hypot(x - tx, y - ty).toFixed(2)} m d'un tronc (${tx}, ${ty})`);
          }
        }
      }
    }
  });

  it("kiosque : octogone de 4,3 à 4,6 m de rayon, bâtiment BD TOPO masqué, contour obstacle, épi à 6 – 7 m du plancher", () => {
    expect(band.nv).toBe(8);
    expect(band.r).toBeGreaterThan(4.2);
    expect(band.r).toBeLessThan(4.7);
    expect(kinds.buildings[band.id]?.k).toBe("hidden");
    expect(band.top - (band.hi + band.floor)).toBeGreaterThan(6);
    expect(band.top - (band.hi + band.floor)).toBeLessThan(7);
    const rings = landmarkRings(kinds, () => 0);
    const c = new Colliders();
    for (const r of rings) c.addRing(r);
    const mid = band.r * Math.cos(Math.PI / 8), am = band.ph + Math.PI / 8; // milieu d'une face du contour
    expect(c.resolve(band.c[0] + mid * Math.cos(am), band.c[1] + mid * Math.sin(am), 0.3).hit).toBe(true);
    expect(c.resolve(band.c[0] + band.r + 1.5, band.c[1], 0.3).hit).toBe(false);
    expect(bandstandRing(band)).toHaveLength(8);
  });

  it("aucune cache d'arme à moins de 3 m d'un rideau ou du kiosque", () => {
    for (const q of CACHES) {
      for (const s of curtains) expect(inCurtain(s, q.x, q.y, 3)).toBe(false);
      expect(Math.hypot(q.x - band.c[0], q.y - band.c[1])).toBeGreaterThan(band.r + 3);
    }
  });

  it("géométrie finie et coût borné (tous les rideaux sous 3 000 triangles, kiosque sous 500)", () => {
    const cb = new MeshBuilder();
    for (const s of curtains) buildCurtain(cb, s, world.terrain);
    expect(cb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(cb)).toBeLessThan(3000);
    const bb = new MeshBuilder();
    buildBandstand(bb, band, world.terrain);
    expect(bb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(bb)).toBeGreaterThan(100);
    expect(tris(bb)).toBeLessThan(500);
  });
});

/** D227 : monument aux morts de la place du Champ de Mars, d'après les photos de l'utilisateur (tools/data/build_square.py). */
describe("place du Champ de Mars : monument aux morts (D227)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const m = kinds.sites.find((s): s is MemorialSite => s.t === "memorial")!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;

  it("mesuré au LiDAR près du point OpenStreetMap, face avant au nord-est (axe de l'allée des rideaux est), 8 à 9 m de haut", () => {
    expect(m).toBeDefined();
    expect(Math.hypot(m.c[0] - 30.77, m.c[1] + 52.1)).toBeLessThan(1.5);
    expect((m.a * 180) / Math.PI).toBeCloseTo(37.8, 1);
    expect(m.top - m.g).toBeGreaterThan(8);
    expect(m.top - m.g).toBeLessThan(9);
    // Le monument est dans l'axe de l'allée entre les deux rideaux de tilleuls est : sa photo de dos y est prise.
    const est = kinds.sites.filter((s): s is CurtainSite => s.t === "curtain" && s.n.startsWith("Tilleuls est"));
    const mx = (est[0]!.c[0] + est[1]!.c[0]) / 2, my = (est[0]!.c[1] + est[1]!.c[1]) / 2;
    const off = -(m.c[0] - mx) * Math.sin(m.a) + (m.c[1] - my) * Math.cos(m.a);
    expect(Math.abs(off)).toBeLessThan(1.5);
  });

  it("remplace le pavé générique ; l'esplanade est un obstacle, pas le reste de la place", () => {
    const all = [...world.tile.furniture];
    expect(all.some((f) => f.id === m.id)).toBe(true);
    expect(furnitureOutsideMonuments(kinds, all).some((f) => f.id === m.id)).toBe(false);
    const c = new Colliders();
    for (const r of landmarkRings(kinds, () => 0)) c.addRing(r);
    const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
    const [d, w] = m.steps[0]!;
    expect(c.resolve(...at(f, d / 2 - 0.1, 0), 0.3).hit).toBe(true);
    expect(c.resolve(...at(f, 0, w / 2 - 0.1), 0.3).hit).toBe(true);
    expect(c.resolve(...at(f, d / 2 + 1, 0), 0.3).hit).toBe(false);
    expect(memorialRing(m)).toHaveLength(4);
  });

  it("l'« arbre » de 7,9 m du relevé (le génie ailé) n'est plus dessiné ni obstacle", () => {
    const inside = world.tile.trees.filter(([x, y]) => inMemorial(m, x, y, 1));
    expect(inside.length).toBeGreaterThanOrEqual(1);
    const shown = treesOutsideMonuments(kinds, world.tile.trees);
    for (const t of inside) expect(shown.includes(t)).toBe(false);
  });

  it("relief aplani sous l'esplanade : il ne dépasse pas le degré du bas (la bosse du MNT montait à 0,85 m)", () => {
    const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
    const [d, w, h] = m.steps[0]!;
    for (let u = -d / 2 - 0.5; u <= d / 2 + 0.5; u += 0.25) {
      for (let t = -w / 2 - 0.5; t <= w / 2 + 0.5; t += 0.25) expect(world.terrain.heightAt(...at(f, u, t))).toBeLessThan(m.g + h - 0.05);
    }
  });

  it("aucune cache d'arme à moins de 3 m de l'esplanade ; aucune file de passants dessus", () => {
    const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
    const inside = (x: number, y: number, margin: number): boolean => {
      const dx = x - f.x, dy = y - f.y;
      return Math.abs(dx * f.ux + dy * f.uy) < m.steps[0]![0] / 2 + margin && Math.abs(dx * f.vx + dy * f.vy) < m.steps[0]![1] / 2 + margin;
    };
    for (const q of CACHES) expect(inside(q.x, q.y, 3)).toBe(false);
    const { n, e, g } = (JSON.parse(readFileSync("public/data/nav/s6_8.json", "utf8")) as { ped: { n: number[]; e: number[]; g: number[] } }).ped;
    for (let i = 0; i < e.length; i += 11) {
      const [a, b, , , , , , , , p0, np] = e.slice(i, i + 11) as number[];
      const pts: [number, number][] = [[n[3 * a!]!, n[3 * a! + 1]!]];
      for (let k = 0; k < np!; k++) pts.push([g[2 * (p0! + k)]!, g[2 * (p0! + k) + 1]!]);
      pts.push([n[3 * b!]!, n[3 * b! + 1]!]);
      for (let j = 0; j + 1 < pts.length; j++) {
        const [ax, ay] = pts[j]!, [bx, by] = pts[j + 1]!;
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
        for (let k = 0; k <= steps; k++) expect(inside(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, 0.4)).toBe(false);
      }
    }
  });

  it("point d'intérêt « monument » des passants devant les marches, tourné vers le monument", () => {
    const P = (JSON.parse(readFileSync("public/data/nav/s6_8.json", "utf8")) as { poi: number[] }).poi;
    const pois: number[][] = [];
    for (let i = 0; i < P.length; i += 5) if (P[i] === 8) pois.push(P.slice(i, i + 5));
    const near = pois.filter(([, x, y]) => Math.hypot(x! - m.c[0], y! - m.c[1]) < 8);
    expect(near).toHaveLength(1);
    const [, x, y, hd] = near[0]!;
    const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
    const s = (x! - f.x) * f.ux + (y! - f.y) * f.uy;
    expect(s).toBeGreaterThan(m.steps[0]![0] / 2 + 0.5);
    // Cap (depuis le nord, sens horaire) vers le centre du monument.
    const want = Math.atan2(m.c[0] - x!, m.c[1] - y!);
    expect(Math.abs(Math.atan2(Math.sin(hd! - want), Math.cos(hd! - want)))).toBeLessThan(0.05);
  });

  it("géométrie finie, sommet du génie au sommet mesuré, coût borné (moins de 3 000 triangles)", () => {
    const mb = new MeshBuilder();
    buildMemorial(mb, m, world.terrain);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    let top = -Infinity;
    for (let i = 1; i < mb.positions.length; i += 3) top = Math.max(top, mb.positions[i]!);
    expect(top).toBeCloseTo(m.top, 1);
    expect(tris(mb)).toBeGreaterThan(800);
    expect(tris(mb)).toBeLessThan(3000);
  });
});
