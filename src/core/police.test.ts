import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { EvadeWatch, policeSees, Search, SIGHT, type PoliceUnit } from "./police";
import { loadRealRoadWorld } from "./testing";
import { Wanted } from "./wanted";

describe("police : vue, fouille, refus de s'arrêter (J4)", () => {
  it("une patrouille voit devant elle et tout près, pas derrière au loin ; en poursuite, partout jusqu'à 90 m ; un mur cache", () => {
    const patrol: PoliceUnit[] = [{ x: 0, y: 0, heading: 0, chasing: false }];
    expect(policeSees(patrol, 0, 40, null)).toBe(true);
    expect(policeSees(patrol, 0, -40, null)).toBe(false);
    expect(policeSees(patrol, 0, -10, null)).toBe(true);
    expect(policeSees(patrol, 0, SIGHT.patrol + 5, null)).toBe(false);
    const chaser: PoliceUnit[] = [{ x: 0, y: 0, heading: 0, chasing: true }];
    expect(policeSees(chaser, 0, -80, null)).toBe(true);
    expect(policeSees(chaser, 0, -95, null)).toBe(false);
    const wall = new Colliders();
    wall.addSegment(-5, 20, 5, 20);
    expect(policeSees(chaser, 0, 30, wall)).toBe(false);
    expect(policeSees(chaser, 0, 10, wall)).toBe(true);
  });

  it("la fouille va d'abord à la dernière position connue, puis de point en point sur des routes de la zone de recherche", () => {
    const { nav } = loadRealRoadWorld();
    const w = new Wanted();
    w.set(2, -10, -40);
    w.update(0.1, -10, -40, true);
    const s = new Search(5);
    s.update(0.1, w, -10, -40, [], nav.road);
    expect([s.x, s.y]).toEqual([-10, -40]);
    w.update(0.1, 300, 300, false);
    s.update(0.1, w, 300, 300, [], nav.road);
    // Le joueur n'est plus vu : on va là où on l'a vu en dernier, pas là où il est.
    expect([s.x, s.y]).toEqual([w.lastX, w.lastY]);
    const units: PoliceUnit[] = [{ x: s.x, y: s.y, heading: 0, chasing: true }];
    const seen = new Set<string>();
    for (let k = 0; k < 8; k++) {
      units[0]!.x = s.x;
      units[0]!.y = s.y;
      s.update(0.1, w, 300, 300, units, nav.road);
      seen.add(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
      expect(Math.hypot(s.x - w.lastX, s.y - w.lastY)).toBeLessThan(w.radius + 41);
      expect(nav.road.nearest(s.x, s.y, 0.5)).not.toBeNull();
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("refus de s'arrêter : six secondes à rouler, vu par une voiture en poursuite toute proche, à une étoile seulement", () => {
    const e = new EvadeWatch();
    const near: PoliceUnit[] = [{ x: 0, y: 10, heading: 0, chasing: true }];
    let fired = 0;
    for (let i = 0; i < 60 * 5; i++) if (e.update(1 / 60, 1, true, 0, 0, 10, near)) fired++;
    expect(fired).toBe(0);
    for (let i = 0; i < 60 * 2; i++) if (e.update(1 / 60, 1, true, 0, 0, 10, near)) fired++;
    expect(fired).toBe(1);
    const e2 = new EvadeWatch();
    for (let i = 0; i < 60 * 10; i++) if (e2.update(1 / 60, 2, true, 0, 0, 10, near) || e2.update(1 / 60, 1, true, 0, 0, 1, near)) fired++;
    expect(fired).toBe(1);
  });
});
