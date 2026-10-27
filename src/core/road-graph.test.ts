import { describe, expect, it } from "vitest";
import { ROAD_FLAG } from "../data/nav";
import { moveDir, moveEdge, reverseMove, SIGN } from "./road-graph";
import { NavGraph } from "./nav-graph";
import { loadRealNav } from "./testing";

const { cells } = loadRealNav();
const full = (): NavGraph => {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  return g;
};
const SHIFT = 65536;

/** Sens parcourus atteignables depuis le sens `start` en suivant `next` ; renvoie les arêtes vues. */
function reach(g: NavGraph, start: number): Set<number> {
  const seen = new Set<number>([moveEdge(start)]);
  const stack = [start], out: number[] = [];
  while (stack.length) {
    const m = stack.pop()!;
    out.length = 0;
    g.road.next(m, out);
    // Une impasse : demi-tour permis (c'est ce que fera le conducteur).
    if (out.length === 0 && g.road.canGo(reverseMove(m))) out.push(reverseMove(m));
    for (const n of out) {
      if (seen.has(moveEdge(n))) continue;
      seen.add(moveEdge(n));
      stack.push(n);
    }
  }
  return seen;
}

describe("graphe routier raccordé (J3-0)", () => {
  it("a une arête routière par arête du fichier et un portail jumeau de chaque côté d'une frontière", () => {
    const g = full();
    let edges = 0;
    for (const c of cells) edges += c.road.edges;
    expect(g.road.edgeCount).toBe(edges);
    expect(g.road.portalCount).toBeGreaterThan(30);
    // Chaque arête qui arrive à un portail (hors bord du monde) a une suite dans l'autre super-tuile, ou aucune si elle n'y mène nulle part.
    const out: number[] = [];
    let crossings = 0;
    const bad: string[] = [];
    for (const c of cells) {
      const slot = Math.floor(g.edgesOf(c.id)[0]! / SHIFT);
      for (const e of g.road.edgesOfSlot(slot)) {
        for (const dir of [0, 1] as const) {
          const m = e * 2 + dir;
          const n = g.road.arrivalNode(m);
          const f = g.road.nodeFlags(n);
          if (!(f & 1) || f & 2 || !g.road.canGo(m)) continue;
          out.length = 0;
          g.road.next(m, out);
          crossings++;
          if (!out.some((k) => Math.floor(moveEdge(k) / SHIFT) !== slot)) bad.push(`${c.id} ${e} ${dir}`);
        }
      }
    }
    expect(crossings).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });

  it("respecte les sens uniques et exclut allées de parking et voies de bus", () => {
    const g = full();
    let oneWays = 0, shut = 0;
    for (const e of cells.flatMap((c) => g.road.edgesOfSlot(Math.floor(g.edgesOf(c.id)[0]! / SHIFT)))) {
      const flags = g.road.edgeFlags(e);
      if (flags & (ROAD_FLAG.aisle | ROAD_FLAG.bus)) {
        shut++;
        expect(g.road.canGo(e * 2) || g.road.canGo(e * 2 + 1)).toBe(false);
      } else if (flags & ROAD_FLAG.onewayForward) {
        oneWays++;
        expect([g.road.canGo(e * 2), g.road.canGo(e * 2 + 1)]).toEqual([true, false]);
      } else if (flags & ROAD_FLAG.onewayBack) {
        oneWays++;
        expect([g.road.canGo(e * 2), g.road.canGo(e * 2 + 1)]).toEqual([false, true]);
      } else expect([g.road.canGo(e * 2), g.road.canGo(e * 2 + 1)]).toEqual([true, true]);
    }
    expect(oneWays).toBeGreaterThan(300);
    expect(shut).toBeGreaterThan(0);
  });

  it("n'offre jamais une suite qui viole un sens unique, et jamais un demi-tour sur la même arête (sauf boucle)", () => {
    const g = full();
    const out: number[] = [];
    let moves = 0;
    for (const c of cells) {
      for (const e of g.road.edgesOfSlot(Math.floor(g.edgesOf(c.id)[0]! / SHIFT))) {
        for (const dir of [0, 1] as const) {
          out.length = 0;
          g.road.next(e * 2 + dir, out);
          for (const k of out) {
            moves++;
            expect(g.road.canGo(k)).toBe(true);
            // Seule une boucle (arête dont les deux bouts sont le même nœud) peut se reprendre elle-même.
            if (g.road.edgeA(e) !== g.road.edgeB(e)) expect(moveEdge(k)).not.toBe(e);
            // Le sens choisi part bien du nœud où l'on est arrivé (ou de son jumeau, à la même place).
            const from = g.road.departureNode(k), at = g.road.arrivalNode(e * 2 + dir);
            expect(Math.hypot(g.road.nodeX(from) - g.road.nodeX(at), g.road.nodeY(from) - g.road.nodeY(at))).toBeLessThan(0.02);
          }
        }
      }
    }
    expect(moves).toBeGreaterThan(2000);
  });

  it("garde plus de 90 % de la longueur carrossable atteignable en suivant les sens permis depuis la mairie", () => {
    const g = full();
    const start = g.road.nearest(0, 0, 150);
    expect(start).not.toBeNull();
    // Départ dans le sens permis.
    const m0 = g.road.canGo(start!.edge * 2) ? start!.edge * 2 : start!.edge * 2 + 1;
    const seen = reach(g, m0);
    let total = 0, reached = 0;
    for (const c of cells) {
      for (const e of g.road.edgesOfSlot(Math.floor(g.edgesOf(c.id)[0]! / SHIFT))) {
        if (!g.road.drivable(e)) continue;
        total += g.road.edgeLength(e);
        if (seen.has(e)) reached += g.road.edgeLength(e);
      }
    }
    expect(reached / total).toBeGreaterThan(0.9);
  });

  it("ne garde aucune trace d'une super-tuile retirée", () => {
    const g = full();
    const edges = g.road.edgeCount, portals = g.road.portalCount;
    for (let i = 0; i < 20; i++) {
      for (const c of cells) {
        g.remove(c.id);
        g.add(c);
      }
    }
    expect(g.road.edgeCount).toBe(edges);
    expect(g.road.portalCount).toBe(portals);
    for (const c of cells) g.remove(c.id);
    expect(g.road.edgeCount).toBe(0);
    expect(g.road.portalCount).toBe(0);
  });

  it("retrouve l'arête carrossable la plus proche, et donne position et cap le long d'une arête", () => {
    const g = full();
    const out = { x: 0, y: 0 };
    let n = 0, checked = 0;
    for (const c of cells) {
      for (const e of g.road.edgesOfSlot(Math.floor(g.edgesOf(c.id)[0]! / SHIFT))) {
        if (!g.road.drivable(e) || n++ % 20 !== 0) continue;
        const len = g.road.edgeLength(e);
        g.road.pointAt(e, 0, out);
        expect(Math.hypot(out.x - g.road.nodeX(g.road.edgeA(e)), out.y - g.road.nodeY(g.road.edgeA(e)))).toBeLessThan(1e-3);
        g.road.pointAt(e, len, out);
        expect(Math.hypot(out.x - g.road.nodeX(g.road.edgeB(e)), out.y - g.road.nodeY(g.road.edgeB(e)))).toBeLessThan(1e-3);
        g.road.pointAt(e, len / 2, out);
        const h = g.road.nearest(out.x, out.y, 0.5);
        expect(h).not.toBeNull();
        expect(h!.dist).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(g.road.nearest(-1e5, -1e5, 50)).toBeNull();
  });

  it("lit les panneaux d'approche : un feu précis par sens, jamais sur une arête qui ne touche pas le nœud", () => {
    const g = full();
    const kinds = new Map<number, number>();
    for (const c of cells) {
      for (const e of g.road.edgesOfSlot(Math.floor(g.edgesOf(c.id)[0]! / SHIFT))) {
        for (const dir of [0, 1] as const) {
          const k = g.road.signAt(e * 2 + dir);
          if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1);
        }
        expect(moveDir(e * 2 + 1)).toBe(1);
      }
    }
    expect(kinds.get(SIGN.stop)).toBeGreaterThan(30);
    expect(kinds.get(SIGN.signal)).toBeGreaterThan(10);
  });

  it("compte les branches d'un carrefour et trouve des impasses et des carrefours à trois branches ou plus", () => {
    const g = full();
    let dead = 0, junction = 0;
    for (const c of cells) {
      const slot = Math.floor(g.edgesOf(c.id)[0]! / SHIFT);
      for (const e of g.road.edgesOfSlot(slot)) {
        if (!g.road.drivable(e)) continue;
        for (const end of [0, 1] as const) {
          const k = g.road.arms(g.road.edgeNode(e, end));
          if (k === 1) dead++;
          if (k >= 3) junction++;
        }
      }
    }
    expect(dead).toBeGreaterThan(50);
    expect(junction).toBeGreaterThan(300);
  });
});
