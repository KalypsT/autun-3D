import { describe, expect, it } from "vitest";
import { pickSpawn, spawnRing, visibleFrom } from "./traffic-spawn";
import { loadRealRoadWorld } from "./testing";
import { vehicleDef } from "./vehicle-catalog";

const real = loadRealRoadWorld();
const { nav, colliders } = real;
const hull = vehicleDef("citadine")!.spec.hull;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("naissance des voitures (D64)", () => {
  it("la couronne s'éloigne avec la vitesse : 60 à 150 m à l'arrêt, jusqu'à 140 à 230 m au-delà de 27 m/s", () => {
    expect(spawnRing(0)).toEqual({ rIn: 60, rOut: 150 });
    expect(spawnRing(10)).toEqual({ rIn: 90, rOut: 180 });
    expect(spawnRing(60)).toEqual({ rIn: 140, rOut: 230 });
  });

  it("choisit des voies libres dans la couronne, hors du champ de vision, loin des autres voitures, sur des obstacles fixes jamais touchés", () => {
    const random = rng(5);
    const taken = [{ x: 0, y: 0 }];
    let found = 0;
    const attempts = 150;
    for (let i = 0; i < attempts; i++) {
      const yaw = random() * Math.PI * 2;
      const px = (random() - 0.5) * 600, py = (random() - 0.5) * 600;
      const sp = pickSpawn(nav, { px, py, yaw, speed: 0, rnd: random, taken, solidAt: () => true, colliders, hull });
      if (!sp) continue;
      found++;
      const d = Math.hypot(sp.x - px, sp.y - py);
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(150);
      expect(visibleFrom(px, py, yaw, 0.95, sp.x, sp.y, colliders)).toBe(false);
      expect(Math.hypot(sp.x, sp.y)).toBeGreaterThanOrEqual(20);
      const sx = Math.sin(sp.heading), sy = Math.cos(sp.heading);
      for (const [off, r] of hull) expect(colliders.resolve(sp.x + sx * off, sp.y + sy * off, r).hit).toBe(false);
      expect(nav.road.canGo(sp.move)).toBe(true);
    }
    // Il y a presque toujours de la place quelque part dans la couronne (hors nature : rien à moins de 150 m).
    expect(found).toBeGreaterThan(attempts * 0.75);
  });

  it("est reproductible avec la même graine, et ne choisit pas deux fois la même voie avec des graines différentes", () => {
    const q = (seed: number) => pickSpawn(nav, { px: 0, py: 0, yaw: 0, speed: 0, rnd: rng(seed), taken: [], solidAt: () => true, colliders, hull });
    expect(q(1)).toEqual(q(1));
    const picks = new Set<string>();
    for (let s = 1; s <= 30; s++) {
      const p = q(s);
      if (p) picks.add(`${p.move}:${p.s.toFixed(1)}`);
    }
    expect(picks.size).toBeGreaterThan(20);
  });

  it("voit un point à découvert dans l'axe du regard, pas un point derrière le joueur, pas un point masqué par un mur", () => {
    // À découvert (loin de tout) : visible dans le champ, invisible derrière.
    expect(visibleFrom(1e5, 1e5, 0, 0.95, 1e5, 1e5 + 80, colliders)).toBe(true);
    expect(visibleFrom(1e5, 1e5, 0, 0.95, 1e5, 1e5 - 80, colliders)).toBe(false);
    expect(visibleFrom(1e5, 1e5, 0, 0.95, 1e5 + 80, 1e5 + 10, colliders)).toBe(false);
    // Un mur entre les deux : le joueur le regarde de face, le point est de l'autre côté.
    let tested = 0;
    for (const sg of colliders.segments.slice(0, 400)) {
      const len = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
      if (len < 4) continue;
      const mx = (sg.ax + sg.bx) / 2, my = (sg.ay + sg.by) / 2;
      const nx = -(sg.by - sg.ay) / len, ny = (sg.bx - sg.ax) / len;
      const px = mx + nx * 15, py = my + ny * 15, tx = mx - nx * 15, ty = my - ny * 15;
      const yaw = Math.atan2(tx - px, ty - py);
      expect(visibleFrom(px, py, yaw, 0.95, tx, ty, colliders)).toBe(false);
      tested++;
    }
    expect(tested).toBeGreaterThan(100);
  });

  it("refuse tout point d'une tuile non construite et toute place déjà prise", () => {
    const rnd = rng(3);
    expect(pickSpawn(nav, { px: 0, py: 0, yaw: 0, speed: 0, rnd, taken: [], solidAt: () => false, colliders, hull })).toBeNull();
    const everywhere = [];
    for (let x = -300; x <= 300; x += 20) for (let y = -300; y <= 300; y += 20) everywhere.push({ x, y });
    expect(pickSpawn(nav, { px: 0, py: 0, yaw: 0, speed: 0, rnd, taken: everywhere, solidAt: () => true, colliders, hull })).toBeNull();
  });
});
