import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import type { LodBuilding, Site, TheatreSite, TileKinds } from "../data/types";
import { Decks, STEP_UP } from "../core/decks";
import { landmarkCircles, treesOutsideMonuments } from "../core/landmarks";
import { inTheatre, laneStepZ, laneZ, theatreDecks, theatreLayout, theatreSectors, theatreWalls, xyOf } from "../core/theatre";
import { MeshBuilder } from "./geometry";
import { idKey } from "./style";
import { buildTheatre } from "./theatre";

const ID = "BATIMENT0000000035039419";

describe("théâtre romain (D133)", () => {
  const world = loadRealWorld();
  const k = JSON.parse(readFileSync("public/data/kinds/29_36.json", "utf8")) as TileKinds;
  const s = k.sites.find((q): q is TheatreSite => q.t === "theatre")!;
  const L = theatreLayout(s);
  const bare = (x: number, y: number): number => (world.terrain.ground ?? world.terrain).heightAt(x, y);

  it("mesures plausibles : orchestre, gradins restaurés, précinction, sommet, escaliers, scène ; l'immeuble BD TOPO est masqué", () => {
    expect(k.buildings[ID]).toEqual({ k: "hidden" });
    expect(s.ro).toBeGreaterThan(24);
    expect(s.ro).toBeLessThan(29);
    // Cavea ouverte vers l'est-nord-est, 148 m de diamètre (sources), 17 m de l'orchestre au sommet.
    expect(Math.cos(s.a + Math.PI)).toBeGreaterThan(0.8);
    expect(s.up[3]).toBeGreaterThan(70);
    expect(s.up[3]).toBeLessThan(80);
    expect(s.up[4] - s.zo).toBeGreaterThan(14);
    expect(s.up[4] - s.zo).toBeLessThan(20);
    // Quinze rangs (photos) de 30 à 45 cm jusqu'à la précinction, sur environ 120° autour de l'axe.
    expect(L.rows).toHaveLength(15);
    expect(L.rise).toBeGreaterThan(0.3);
    expect(L.rise).toBeLessThan(0.45);
    expect(L.rows[14]!.z).toBeCloseTo(s.pr[2], 5);
    expect(s.rest[1] - s.rest[0]).toBeGreaterThan(1.8);
    expect(s.rest[1] - s.rest[0]).toBeLessThan(2.4);
    expect(s.lanes[0]).toHaveLength(3);
    expect(s.lanes[1]).toHaveLength(6);
    expect(s.cun).toHaveLength(7);
    // Scène moderne : plateau 1 à 2 m au-dessus de l'orchestre, marches de moins de 20 cm.
    expect(L.stage.zt - s.zo).toBeGreaterThan(1);
    expect(L.stage.zt - s.zo).toBeLessThan(2);
    expect((L.stage.zt - s.zo) / L.stage.steps).toBeLessThan(0.2);
    // Silhouette lointaine : l'immeuble n'y est plus (la cavea est un creux du relief).
    const lod = JSON.parse(readFileSync("public/data/lod/29_36.json", "utf8")) as LodBuilding[];
    expect(lod.filter((e) => e.k === Math.round(idKey(ID) * 4294967296))).toHaveLength(0);
    // Piste du stade en terre battue (photo).
    expect(k.sites.some((q: Site) => q.t === "track" && q.s === "dirt")).toBe(true);
  });

  it("sommets finis, coût en triangles borné", () => {
    const mb = new MeshBuilder();
    buildTheatre(mb, s, world.terrain);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.triangleCount).toBeGreaterThan(1000);
    expect(mb.triangleCount).toBeLessThan(12000);
  });

  it("tabliers alignés sur les marches dessinées (moins de 20 cm) ; de l'orchestre au sommet par l'escalier de l'axe, sans marche de plus de STEP_UP", () => {
    for (const l of [...L.lanesLow, ...L.lanesUp]) {
      for (const p of l.pieces) {
        for (let R = p.r0 + 0.01; R < p.r1; R += 0.05) expect(Math.abs(laneZ(l, R)! - laneStepZ(l, R)!)).toBeLessThan(0.2);
      }
    }
    const decks = new Decks();
    decks.add("29_36", theatreDecks(s));
    decks.addSectors("29_36", theatreSectors(s));
    // Chaque rang : la surface est exactement le dessus du rang.
    for (const row of L.rows) {
      const [x, y] = xyOf(L, (row.r0 + row.r1) / 2, (L.rest[0] + L.lanesLow[0]!.u) / 2);
      expect(decks.surface(x, y, bare(x, y))).toBeCloseTo(Math.max(row.z, bare(x, y)), 5);
    }
    // Montée par l'escalier de l'axe puis celui du haut le plus proche.
    const axis = L.lanesLow.find((l) => l.pieces.length > 1)!;
    const up = L.lanesUp.reduce((a, b) => (Math.abs(b.u - axis.u) < Math.abs(a.u - axis.u) ? b : a));
    const path: [number, number][] = [];
    for (let R = s.ro - 3; R < L.r1; R += 0.1) path.push([R, axis.u]);
    for (let i = 0; i <= 20; i++) path.push([L.r1 + ((L.r2 + 0.5 - L.r1) * i) / 20, axis.u + ((up.u - axis.u) * i) / 20]);
    for (let R = L.r2 + 0.5; R < L.r4 - 0.2; R += 0.1) path.push([R, up.u]);
    let z = bare(...xyOf(L, path[0]![0], path[0]![1]));
    for (const [R, u] of path) {
      const [x, y] = xyOf(L, R, u);
      const nz = decks.surface(x, y, bare(x, y), z);
      expect(nz - z).toBeLessThan(STEP_UP);
      z = nz;
    }
    expect(z).toBeGreaterThan(s.zo + 13);
  });

  it("détails (D134) : coins du haut à rangs restaurés, ruines en blocs irréguliers, chaque morceau praticable à sa hauteur", () => {
    const rows = L.pieces.filter((p) => p.kind === "row");
    expect(rows.length).toBe(39);
    for (const b of L.blocks.filter((q) => q.rows > 1)) {
      const r = L.pieces.filter((p) => p.kind === "row" && p.u0 === b.u0);
      const rise = (r[r.length - 1]!.z0 - r[0]!.z0) / (r.length - 1);
      expect(rise).toBeGreaterThan(0.3);
      expect(rise).toBeLessThan(0.45);
    }
    const ruins = L.pieces.filter((p) => p.kind === "ruin");
    expect(ruins.length).toBeGreaterThan(60);
    expect(new Set(ruins.map((p) => p.z0.toFixed(2))).size).toBeGreaterThan(40);
    const decks = new Decks();
    decks.addSectors("29_36", theatreSectors(s));
    for (const p of [...rows, ...ruins]) {
      const [x, y] = xyOf(L, (p.r0 + p.r1) / 2, (p.u0 + p.u1) / 2);
      expect(decks.surface(x, y, bare(x, y))).toBeCloseTo(Math.max(p.z0, bare(x, y)), 5);
    }
  });

  it("passants (D135) : chemins et escaliers du théâtre reliés au réseau, sans marche trop haute ni obstacle en travers", () => {
    const nav = JSON.parse(readFileSync("public/data/nav/s7_9.json", "utf8")) as { ped: { n: number[]; e: number[]; g: number[] } };
    const { n, e, g } = nav.ped;
    const REF = 153779957;
    const lines: [number, number][][] = [];
    const adj = new Map<number, number[]>();
    for (let i = 0; i < e.length; i += 11) {
      const [a, b, , , , , , , ref, p0, np] = e.slice(i, i + 11) as number[];
      (adj.get(a!) ?? adj.set(a!, []).get(a!)!).push(b!);
      (adj.get(b!) ?? adj.set(b!, []).get(b!)!).push(a!);
      if (ref !== REF) continue;
      const pts: [number, number][] = [[n[3 * a!]!, n[3 * a! + 1]!]];
      for (let k = 0; k < np!; k++) pts.push([g[2 * (p0! + k)]!, g[2 * (p0! + k) + 1]!]);
      pts.push([n[3 * b!]!, n[3 * b! + 1]!]);
      lines.push(pts);
    }
    expect(lines.length).toBeGreaterThan(25);
    // Relié : depuis le carrefour de l'orchestre, on atteint plus de 500 nœuds de la super-tuile (le reste de la ville).
    const [hx, hy] = xyOf(L, 10, 0);
    let hub = 0;
    for (let k = 0; k < n.length / 3; k++) if (Math.hypot(n[3 * k]! - hx, n[3 * k + 1]! - hy) < Math.hypot(n[3 * hub]! - hx, n[3 * hub + 1]! - hy)) hub = k;
    const seen = new Set([hub]), todo = [hub];
    while (todo.length) for (const m of adj.get(todo.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); todo.push(m); }
    expect(seen.size).toBeGreaterThan(500);
    // En marchant le long de chaque chemin, dans les deux sens, aucune marche de plus de STEP_UP.
    const decks = new Decks();
    decks.add("29_36", theatreDecks(s));
    decks.addSectors("29_36", theatreSectors(s));
    for (const pts of lines) {
      for (const way of [pts, [...pts].reverse()]) {
        let z = decks.surface(way[0]![0], way[0]![1], bare(way[0]![0], way[0]![1]));
        for (let i = 0; i + 1 < way.length; i++) {
          const [ax, ay] = way[i]!, [bx, by] = way[i + 1]!;
          const m = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
          for (let k = 1; k <= m; k++) {
            const x = ax + ((bx - ax) * k) / m, y = ay + ((by - ay) * k) / m;
            const nz = decks.surface(x, y, bare(x, y), z);
            expect(nz - z).toBeLessThan(STEP_UP);
            z = nz;
          }
        }
      }
    }
    // Aucun obstacle du théâtre ne coupe un chemin.
    const cross = (p: number[], q: number[], r: number[], t: number[]): boolean => {
      const d = (a: number[], b: number[], c: number[]): number => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
      return d(p, q, r) * d(p, q, t) < 0 && d(r, t, p) * d(r, t, q) < 0;
    };
    let hits = 0;
    for (const w of theatreWalls(s, bare)) {
      for (let i = 0; i + 3 < w.pts.length; i += 2) {
        const p = [w.pts[i]!, w.pts[i + 1]!], q = [w.pts[i + 2]!, w.pts[i + 3]!];
        for (const pts of lines) for (let k = 0; k + 1 < pts.length; k++) if (cross(p, q, pts[k]!, pts[k + 1]!)) hits++;
      }
    }
    expect(hits).toBe(0);
  });

  it("mobilier (D136) : deux poteaux d'éclairage d'environ 9 m et quatre arbustes, obstacles ; l'« arbre » du pied du premier poteau est retiré", () => {
    expect(s.poles).toHaveLength(2);
    for (const [, , h] of s.poles!) {
      expect(h).toBeGreaterThan(7);
      expect(h).toBeLessThan(12);
    }
    expect(s.shrubs).toHaveLength(4);
    const circles = landmarkCircles(k, []);
    for (const [x, y] of [...s.poles!, ...s.shrubs!]) expect(circles.some(([cx, cy]) => cx === x && cy === y)).toBe(true);
    const tile = JSON.parse(readFileSync("public/data/tiles/29_36.json", "utf8")) as { trees: [number, number, number, number, number, number][] };
    const [px, py] = s.poles![0]!;
    expect(tile.trees.some(([x, y]) => Math.hypot(x - px, y - py) < 1.5)).toBe(true);
    expect(treesOutsideMonuments(k, tile.trees).some(([x, y]) => Math.hypot(x - px, y - py) < 1.5)).toBe(false);
  });

  it("obstacles : podium coupé par l'escalier de l'axe, barrières de la scène, massifs ; arbres retirés de la cavea", () => {
    const walls = theatreWalls(s, bare);
    const podium = walls.filter((w) => w.low && w.top.height > 1.2);
    expect(podium).toHaveLength(2);
    expect(walls.filter((w) => w.low && Math.abs(w.top.height - 1.1) < 1e-6)).toHaveLength(2);
    expect(walls.filter((w) => !w.low).length).toBeGreaterThan(4);
    for (const w of walls) expect(w.pts.every(Number.isFinite)).toBe(true);
    const inside = xyOf(L, 50, 0), outside = xyOf(L, 100, 0);
    expect(inTheatre(s, ...inside)).toBe(true);
    expect(inTheatre(s, ...outside)).toBe(false);
    expect(treesOutsideMonuments(k, [[...inside, 0, 10, 3, 4], [...outside, 0, 10, 3, 4]])).toHaveLength(1);
  });
});
