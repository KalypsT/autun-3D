import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeNavCell, PED } from "../data/nav";
import { navCellDistance, navCellsWanted } from "../game/nav-manager";
import { NavGraph } from "./nav-graph";
import { loadRealNav } from "./testing";

const { index, cells } = loadRealNav();
const full = (): NavGraph => {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  return g;
};
const SHIFT = 65536;
const slotOf = (ref: number): number => Math.floor(ref / SHIFT);

describe("décodage des données de navigation", () => {
  it("refuse une version inconnue et des tableaux de taille incohérente", () => {
    const raw = JSON.parse(JSON.stringify({ v: 1, id: "sX", bounds: [0, 0, 1000, 1000], ped: { n: [0, 0, 0, 1, 1, 0], e: [0, 1, 0, 0, 20, 100, 1, 14, 5, 0, 0], g: [] }, road: { n: [], e: [], g: [], s: [], r: [] }, poi: [] }));
    expect(() => decodeNavCell(raw)).not.toThrow();
    expect(() => decodeNavCell({ ...raw, v: 2 })).toThrow(/version/);
    expect(() => decodeNavCell({ ...raw, ped: { ...raw.ped, n: [0, 0] } })).toThrow(/nœuds/);
    expect(() => decodeNavCell({ ...raw, ped: { ...raw.ped, e: [0, 7, 0, 0, 20, 100, 1, 14, 5, 0, 0] } })).toThrow(/hors tableaux/);
  });

  it("recalcule des longueurs d'arêtes égales à celles du fichier, au décimètre près", () => {
    const off: string[] = [];
    for (const c of cells) {
      const raw = JSON.parse(readFileSync(`public/data/nav/${c.id}.json`, "utf8")) as { ped: { e: number[] } };
      for (let i = 0; i < c.ped.edges; i++) if (Math.abs(c.ped.length[i]! - raw.ped.e[i * 11 + 7]! / 10) > 0.1) off.push(`${c.id} ${i}`);
    }
    expect(off).toEqual([]);
  });
});

describe("graphe piéton raccordé", () => {
  it("passe d'une super-tuile à sa voisine par chaque portail (hors bord du monde)", () => {
    const g = full();
    const out: number[] = [];
    const bad: string[] = [];
    let crossings = 0;
    for (const c of cells) {
      for (const e of g.edgesOf(c.id)) {
        for (const end of [0, 1] as const) {
          const f = g.nodeFlags(g.edgeNode(e, end));
          if (!(f & 1) || f & 2) continue;
          out.length = 0;
          g.next(e, end, out);
          crossings++;
          // Une suite au moins doit appartenir à l'autre super-tuile.
          if (!out.some((m) => slotOf(Math.floor(m / 2)) !== slotOf(e))) bad.push(`${c.id} ${e} ${end}`);
        }
      }
    }
    expect(crossings).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });

  it("relie plus de 90 % de la longueur des files au départ de la mairie, en suivant `next` d'une super-tuile à l'autre", () => {
    const g = full();
    const start = g.nearest(0, 0, 80, 1 << PED.lane);
    expect(start).not.toBeNull();
    const seen = new Set<number>();
    const stack: number[] = [start!.edge * 2];
    const out: number[] = [];
    let reached = 0, total = 0;
    for (const c of cells) for (const e of g.edgesOf(c.id)) total += g.edgeLength(e);
    seen.add(start!.edge);
    reached += g.edgeLength(start!.edge);
    while (stack.length) {
      const m = stack.pop()!;
      const e = Math.floor(m / 2);
      out.length = 0;
      g.next(e, (m & 1) === 0 ? 1 : 0, out);
      for (const n of out) {
        const ne = Math.floor(n / 2);
        if (seen.has(ne)) continue;
        seen.add(ne);
        reached += g.edgeLength(ne);
        stack.push(n);
      }
    }
    expect(reached / total).toBeGreaterThan(0.9);
  });

  it("ne garde aucune trace d'une super-tuile retirée : emplacements recyclés, portails oubliés", () => {
    const g = full();
    const edges = g.edgeCount;
    const portals = g.portalCount;
    expect(portals).toBeGreaterThan(100);
    for (let i = 0; i < 40; i++) {
      for (const c of cells) {
        g.remove(c.id);
        g.add(c);
      }
    }
    expect(g.edgeCount).toBe(edges);
    expect(g.portalCount).toBe(portals);
    for (const c of cells) g.remove(c.id);
    expect(g.edgeCount).toBe(0);
    expect(g.portalCount).toBe(0);
    expect(g.cells.size).toBe(0);
  });

  it("retrouve l'arête la plus proche d'un point, et respecte le filtre de types", () => {
    const g = full();
    const wrong: string[] = [];
    const pts: [number, number][] = [];
    for (const c of cells) {
      const p = c.ped;
      for (let i = 0; i < p.edges; i += 10) {
        if (p.type[i] === PED.lane && p.np[i]! > 0) pts.push([p.geom[p.p0[i]! * 2]!, p.geom[p.p0[i]! * 2 + 1]!]);
      }
    }
    expect(pts.length).toBeGreaterThan(50);
    for (const [x, y] of pts) {
      const h = g.nearest(x, y, 1);
      if (!h || h.dist > 0.01) wrong.push(`${x},${y} ${JSON.stringify(h)}`);
    }
    expect(wrong).toEqual([]);
    expect(g.nearest(-1e5, -1e5, 50)).toBeNull();
    const onlyCrossings = g.nearest(pts[0]![0], pts[0]![1], 60, (1 << PED.crossing) | (1 << PED.crossingSignal));
    expect(onlyCrossings === null || [PED.crossing, PED.crossingSignal].includes(g.edgeType(onlyCrossings.edge) as 2 | 3)).toBe(true);
  });

  it("donne la position et le cap sur une arête : extrémités aux nœuds, milieu sur la polyligne", () => {
    const g = full();
    const out = { x: 0, y: 0 };
    const bad: string[] = [];
    let n = 0;
    for (const c of cells) {
      for (const e of g.edgesOf(c.id)) {
        if (n++ % 25 !== 0) continue;
        const len = g.edgeLength(e);
        g.pointAt(e, 0, out);
        if (Math.hypot(out.x - g.nodeX(g.edgeNode(e, 0)), out.y - g.nodeY(g.edgeNode(e, 0))) > 1e-3) bad.push(`début ${e}`);
        g.pointAt(e, len, out);
        if (Math.hypot(out.x - g.nodeX(g.edgeNode(e, 1)), out.y - g.nodeY(g.edgeNode(e, 1))) > 1e-3) bad.push(`fin ${e}`);
        g.pointAt(e, len / 2, out);
        const h = g.nearest(out.x, out.y, 0.5);
        if (!h || h.dist > 0.02) bad.push(`milieu ${e}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("super-tuiles à charger autour du joueur", () => {
  it("donne d'abord la super-tuile du joueur, puis les voisines selon la distance, et rien hors du monde", () => {
    const [x0, y0] = index.gridOrigin;
    const mid = [x0 + 6.5 * index.cell, y0 + 8.5 * index.cell] as const; // au milieu de s6_8
    expect(navCellsWanted(index, mid[0], mid[1])[0]).toBe("s6_8");
    expect(navCellsWanted(index, mid[0], mid[1])).toEqual(["s6_8"]);
    // Près d'un coin, quatre super-tuiles ; la plus proche d'abord.
    const corner = navCellsWanted(index, x0 + 7 * index.cell - 5, y0 + 9 * index.cell - 5);
    expect(corner.slice().sort()).toEqual(["s6_8", "s6_9", "s7_8", "s7_9"]);
    expect(corner[0]).toBe("s6_8");
    expect(navCellsWanted(index, 1e5, 1e5)).toEqual([]);
    expect(navCellDistance(index, "s6_8", mid[0], mid[1])).toBe(0);
  });

  it("anticipe : en roulant vite vers l'est, la voisine de l'est est demandée avant d'être à portée", () => {
    const [x0, y0] = index.gridOrigin;
    const px = x0 + 6 * index.cell + 550, py = y0 + 8.5 * index.cell;
    expect(navCellsWanted(index, px, py)).toEqual(["s6_8"]);
    expect(navCellsWanted(index, px, py, 25, 0)).toContain("s7_8");
  });
});
