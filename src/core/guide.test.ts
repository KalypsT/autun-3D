import { describe, expect, it } from "vitest";
import { NavGraph } from "./nav-graph";
import { findGuide, pedGuide, polylineLength, roadGuide, routeProgress, type GuideEnd } from "./guide";
import { loadRealNav } from "./testing";

const { cells } = loadRealNav();
const nav = new NavGraph();
for (const c of cells) nav.add(c);

const roadEnd = (x: number, y: number): GuideEnd => {
  const h = nav.road.nearest(x, y, 120)!;
  return { edge: h.edge, s: h.s, x: h.x, y: h.y };
};
const pedEnd = (x: number, y: number): GuideEnd => {
  const h = nav.nearest(x, y, 120)!;
  return { edge: h.edge, s: h.s, x: h.x, y: h.y };
};

/** Trajets à travers la ville : de la mairie vers la gare, la cathédrale, Bellevue, et un long trajet d'un bout à l'autre. */
const TRIPS: [number, number, number, number][] = [
  [0, 0, 600, -900],
  [0, 0, -700, -300],
  [-900, 700, 1500, 500],
  [300, 300, -1500, -500],
];

describe("guidage vers le repère (D310)", () => {
  it("trouve un itinéraire routier qui part du départ, arrive au but, sans détour absurde, en peu de temps", () => {
    for (const [x0, y0, x1, y1] of TRIPS) {
      const from = roadEnd(x0, y0), to = roadEnd(x1, y1);
      const t0 = performance.now();
      const r = findGuide(roadGuide(nav.road), from, to)!;
      const ms = performance.now() - t0;
      expect(r).not.toBeNull();
      const straight = Math.hypot(to.x - from.x, to.y - from.y);
      expect(r.length).toBeGreaterThanOrEqual(straight - 1);
      expect(r.length).toBeLessThan(straight * 2.2 + 200);
      // La ligne dessinée suit le trajet compté.
      expect(Math.abs(polylineLength(r.points) - r.length)).toBeLessThan(r.length * 0.05 + 5);
      expect(Math.hypot(r.points[0]! - from.x, r.points[1]! - from.y)).toBeLessThan(1);
      expect(Math.hypot(r.points.at(-2)! - to.x, r.points.at(-1)! - to.y)).toBeLessThan(1);
      // Pas de saut entre deux points consécutifs (les arêtes s'enchaînent).
      for (let i = 2; i < r.points.length; i += 2) expect(Math.hypot(r.points[i]! - r.points[i - 2]!, r.points[i + 1]! - r.points[i - 1]!)).toBeLessThan(400);
      expect(ms).toBeLessThan(400);
    }
  });

  it("trouve un itinéraire à pied, plus direct qu'en voiture (pas de sens uniques)", () => {
    for (const [x0, y0, x1, y1] of TRIPS.slice(0, 2)) {
      const r = findGuide(pedGuide(nav), pedEnd(x0, y0), pedEnd(x1, y1))!;
      expect(r).not.toBeNull();
      const straight = Math.hypot(x1 - x0, y1 - y0);
      expect(r.length).toBeLessThan(straight * 1.8 + 150);
    }
  });

  it("un demi-tour coûte : le cap du véhicule oriente le départ", () => {
    const from = roadEnd(0, 0), to = roadEnd(600, -900);
    const free = findGuide(roadGuide(nav.road), from, to)!;
    const h = roadGuide(nav.road).headingAt(from.edge, from.s);
    // Cap opposé à la meilleure direction de départ : jamais plus court que sans contrainte.
    const firstDx = free.points[2]! - free.points[0]!, firstDy = free.points[3]! - free.points[1]!;
    const goingAB = Math.cos(Math.atan2(firstDx, firstDy) - h) > 0;
    const constrained = findGuide(roadGuide(nav.road), from, to, { heading: goingAB ? h + Math.PI : h })!;
    expect(constrained.length).toBeGreaterThanOrEqual(free.length - 1);
  });

  it("suit la progression du joueur le long de la ligne", () => {
    const pts = [0, 0, 100, 0, 100, 100];
    const p = routeProgress(pts, 50, 5);
    expect(p.seg).toBe(0);
    expect(p.off).toBeCloseTo(5);
    expect(p.along).toBeCloseTo(50);
    const q = routeProgress(pts, 103, 60);
    expect(q.seg).toBe(1);
    expect(q.along).toBeCloseTo(160);
    expect(polylineLength(pts)).toBe(200);
  });
});
