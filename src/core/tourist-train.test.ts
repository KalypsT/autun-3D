import { describe, expect, it } from "vitest";
import { ROUTE, TrainRoute } from "./train-route";
import { carPoses, lapTime, TRAIN, trainLength, trainOnDuty, trainShown, TrainSim, type CarPose } from "./tourist-train";
import { TRAIN_ROUTE_MONUMENTS } from "./train-route-data";
import { UNIQUES } from "./uniques";

const route = new TrainRoute();
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

describe("circuit du petit train (D117)", () => {
  it("une boucle fermée d'environ 7 km, sans saut ni demi-tour : le cap tourne de moins de 110° sur 5 m (l'épingle au sud des remparts : ≈ 95°)", () => {
    expect(route.length).toBeGreaterThan(6500);
    expect(route.length).toBeLessThan(7300);
    const a = { x: 0, y: 0, heading: 0 }, b = { x: 0, y: 0, heading: 0 };
    for (let s = 0; s < route.length; s += 1) {
      route.at(s, a);
      route.at(s + 1, b);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1.3);
      route.at(s + 5, b);
      expect(Math.abs(wrapAngle(b.heading - a.heading))).toBeLessThan((110 * Math.PI) / 180);
    }
  });

  it("à l'arrêt du départ, tout le train attend dans la rue, sa queue au coin de la rue du Général Demetz ; chaque monument est longé à moins de 40 m", () => {
    expect(trainLength()).toBeLessThan(ROUTE.depot);
    const tail = carPoses(route, 0, []).at(-1)!.rear;
    expect(Math.hypot(tail.x - 44, tail.y + 42)).toBeLessThan(7);
    for (const m of TRAIN_ROUTE_MONUMENTS) {
      const q = route.at(route.nearestS(m.x, m.y), { x: 0, y: 0, heading: 0 });
      expect([m.name, Math.hypot(q.x - m.x, q.y - m.y) < 40]).toEqual([m.name, true]);
    }
  });

  it("aucune place de véhicule unique sur le tracé (le train ne le traverserait pas : il l'ignore, garé à sa place)", () => {
    for (const u of UNIQUES) {
      const q = route.at(route.nearestS(u.x, u.y), { x: 0, y: 0, heading: 0 });
      expect([u.id, Math.hypot(q.x - u.x, q.y - u.y) > 6]).toEqual([u.id, true]);
    }
  });

  it("vitesse permise : 12 km/h en ligne au plus, 6 km/h le long des monuments, jamais à l'arrêt", () => {
    let max = 0, min = Infinity;
    for (const v of route.limit) {
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
    expect(max).toBeCloseTo(ROUTE.cruise, 5);
    expect(min).toBeGreaterThanOrEqual(1);
    const porte = TRAIN_ROUTE_MONUMENTS.find((m) => m.name === "Porte d'Arroux")!;
    expect(route.speedAt(route.nearestS(porte.x, porte.y))).toBeLessThanOrEqual(ROUTE.monument + 1e-9);
    expect(route.signals.length).toBe(12);
  });
});

describe("petit train : marche (D117)", () => {
  it("un tour dure 30 à 50 minutes, arrêt d'une minute au départ compris", () => {
    const t = lapTime(route);
    expect(t).toBeGreaterThan(30 * 60);
    expect(t).toBeLessThan(50 * 60);
  });

  it("les voitures se suivent à écart constant, collées au tracé, sans se chevaucher, même dans les virages", () => {
    const poses: CarPose[] = [];
    for (let s = 0; s < route.length; s += 7) {
      carPoses(route, s, poses);
      expect(poses.length).toBe(TRAIN.cars.length);
      for (let i = 1; i < poses.length; i++) {
        const a = poses[i - 1]!, b = poses[i]!;
        // De l'essieu arrière d'une voiture à l'essieu avant de la suivante : au plus l'écart prévu (moins dans un virage), jamais moins de 70 %.
        const want = TRAIN.gap + TRAIN.cars[i - 1]!.overhang + TRAIN.cars[i]!.overhang, d = Math.hypot(a.rear.x - b.front.x, a.rear.y - b.front.y);
        expect(d).toBeLessThan(want + 0.05);
        expect(d).toBeGreaterThan(want * 0.7);
      }
    }
    expect(trainLength()).toBeGreaterThan(18);
    expect(trainLength()).toBeLessThan(24);
  });

  it("au départ, il attend une minute, puis repart ; au bout du tour, il s'arrête de nouveau au départ", () => {
    const sim = new TrainSim(route);
    for (let t = 0; t < TRAIN.dwell - 1; t += 0.5) sim.update(0.5);
    expect(sim.s).toBe(0);
    for (let t = 0; t < 20; t += 0.1) sim.update(0.1);
    expect(sim.s).toBeGreaterThan(5);
    const end = new TrainSim(route, route.length - 30);
    end.dwell = 0;
    end.speed = ROUTE.cruise;
    for (let t = 0; t < 60 && end.dwell <= 0; t += 0.1) end.update(0.1);
    expect(end.s).toBe(0);
    expect(end.dwell).toBeGreaterThan(TRAIN.dwell - 1);
  });

  it("derrière un obstacle, il s'arrête avant de le toucher ; au feu rouge, avant le carrefour ; puis il repart", () => {
    const sim = new TrainSim(route, 200);
    sim.dwell = 0;
    sim.speed = ROUTE.cruise;
    let gap = 20;
    for (let t = 0; t < 30; t += 0.1) {
      const before = sim.s;
      sim.update(0.1, { obstacle: gap, stopAt: () => null });
      gap -= sim.s - before;
    }
    expect(sim.speed).toBe(0);
    expect(gap).toBeGreaterThan(1);
    // Un feu loin du départ (le premier est au Champ de Mars, juste après le départ).
    const sig = route.signals.find((g) => g.s > 100)!;
    const red = new TrainSim(route, sig.s - 40);
    red.dwell = 0;
    red.speed = route.speedAt(red.s);
    for (let t = 0; t < 60; t += 0.1) red.update(0.1, { obstacle: Infinity, stopAt: () => true });
    expect(red.speed).toBe(0);
    expect(sig.s - red.s).toBeGreaterThan(2);
    expect(sig.s - red.s).toBeLessThan(TRAIN.signalStop + 2);
    for (let t = 0; t < 20; t += 0.1) red.update(0.1, { obstacle: Infinity, stopAt: () => false });
    expect(red.s).toBeGreaterThan(sig.s);
  });

  it("de service de 11 h à 18 h ; il n'apparaît et ne disparaît que loin du joueur", () => {
    expect(trainOnDuty(10.9)).toBe(false);
    expect(trainOnDuty(11)).toBe(true);
    expect(trainOnDuty(17.99)).toBe(true);
    expect(trainOnDuty(18)).toBe(false);
    expect(trainShown(null, 12, 10)).toBe(true);
    expect(trainShown(null, 20, 10)).toBe(false);
    expect(trainShown(true, 18.5, 50)).toBe(true);
    expect(trainShown(true, 18.5, 400)).toBe(false);
    expect(trainShown(false, 11.5, 50)).toBe(false);
    expect(trainShown(false, 11.5, 400)).toBe(true);
  });
});
