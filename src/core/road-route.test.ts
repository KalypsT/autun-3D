import { describe, expect, it } from "vitest";
import { moveEdge } from "./road-graph";
import { findRoute } from "./road-route";
import { loadRealRoadWorld } from "./testing";

const { nav } = loadRealRoadWorld();
const road = nav.road;

function mid(e: number): { x: number; y: number } {
  const p = { x: 0, y: 0 };
  road.pointAt(e, road.edgeLength(e) / 2, p);
  return p;
}

/** Chaque sens de l'itinéraire suit le précédent (suites permises), et le dernier est sur l'arête visée. */
function valid(from: number, route: number[], goal: number, wrongWay: boolean): boolean {
  let prev = from;
  const out: number[] = [];
  for (const m of route) {
    out.length = 0;
    road.next(prev, out, wrongWay);
    if (!out.includes(m)) return false;
    prev = m;
  }
  return route.length === 0 ? moveEdge(from) === goal : moveEdge(route[route.length - 1]!) === goal;
}

describe("itinéraire sur le graphe routier (J4)", () => {
  const starts = loadRealRoadWorld().starts(9);
  const goals = loadRealRoadWorld().starts(13, 30, 6).map(moveEdge);

  it("relie la plupart des couples d'arêtes de l'anneau en suivant les suites permises, sans détour absurde", () => {
    let ok = 0, tried = 0, worst = 0;
    for (let i = 0; i < 40; i++) {
      const from = starts[(i * 7) % starts.length]!, goal = goals[(i * 11) % goals.length]!;
      if (moveEdge(from) === goal) continue;
      tried++;
      const g = mid(goal);
      const route = findRoute(road, from, goal, g.x, g.y);
      if (!route) continue;
      expect(valid(from, route, goal, false)).toBe(true);
      ok++;
      // Longueur du trajet comparée à la distance à vol d'oiseau (le détour par les rues).
      const a = mid(moveEdge(from));
      let len = 0;
      for (const m of route) len += road.edgeLength(moveEdge(m));
      const crow = Math.hypot(g.x - a.x, g.y - a.y);
      if (crow > 200) worst = Math.max(worst, len / crow);
    }
    expect(ok / tried).toBeGreaterThan(0.85);
    expect(worst).toBeLessThan(4);
  });

  it("en ignorant les sens uniques (police), trouve toujours au moins autant d'itinéraires, jamais plus longs", () => {
    let strict = 0, loose = 0;
    for (let i = 0; i < 30; i++) {
      const from = starts[(i * 5) % starts.length]!, goal = goals[(i * 3 + 1) % goals.length]!;
      const g = mid(goal);
      const a = findRoute(road, from, goal, g.x, g.y);
      const b = findRoute(road, from, goal, g.x, g.y, { wrongWay: true });
      if (a) strict++;
      if (b) {
        loose++;
        expect(valid(from, b, goal, true)).toBe(true);
      }
      if (a && b) {
        const len = (r: number[]): number => r.reduce((s, m) => s + road.edgeLength(moveEdge(m)), 0);
        expect(len(b)).toBeLessThanOrEqual(len(a) * 1.25 + 1);
      }
    }
    expect(loose).toBeGreaterThanOrEqual(strict);
  });

  it("rend un itinéraire vide quand on est déjà sur l'arête, null quand la recherche est bornée trop court", () => {
    const from = starts[0]!;
    const p = mid(moveEdge(from));
    expect(findRoute(road, from, moveEdge(from), p.x, p.y)).toEqual([]);
    const far = goals[goals.length - 1]!, g = mid(far);
    expect(findRoute(road, from, far, g.x, g.y, { maxExpand: 1 })).toBeNull();
  });

  it("reste rapide : moins de 2 ms en moyenne par recherche (PC, ×3 sur le téléphone)", () => {
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const from = starts[(i * 13) % starts.length]!, goal = goals[(i * 17) % goals.length]!, g = mid(goal);
      findRoute(road, from, goal, g.x, g.y, { wrongWay: true });
      n++;
    }
    expect((performance.now() - t0) / n).toBeLessThan(2);
  });
});
