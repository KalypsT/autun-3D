import { describe, expect, it } from "vitest";
import { Driver, lanePoint } from "./driver";
import { moveEdge } from "./road-graph";
import { loadRealRoadWorld } from "./testing";
import { TrafficSim } from "./traffic-sim";
import { createVehicle, stepVehicle, type VehicleState } from "./vehicle";
import { vehicleDef } from "./vehicle-catalog";

const { world, nav, colliders, starts } = loadRealRoadWorld();
const DT = 1 / 60;
const POLICE = vehicleDef("gendarmerie")!.spec;
const FUGITIVE = vehicleDef("compacte")!.spec;

interface Run {
  closest: number;
  /** Part du temps (après la première minute) à moins de 60 m. */
  near: number;
  reverses: number;
  plans: number;
  failures: number;
  /** Distance finale après l'arrêt du fugitif. */
  held: number;
  contacts: number;
  /** Pas avec contact après l'arrêt du fugitif. */
  contactsStopped: number;
}

/** Un fugitif (conducteur de la circulation, `fast` : en conduite de poursuite) suivi par une voiture de gendarmerie partie à ≈ 150 m ; le fugitif s'arrête à `stopAt` s. */
function chase(seed: number, seconds: number, stopAt: number, fast: boolean): Run {
  const list = starts(5);
  const from = list[seed % list.length]!;
  const lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.road, from, 5, lp);
  const fug: VehicleState = createVehicle(lp.x, lp.y, lp.heading, world.terrain);
  const fd = new Driver(nav, from, 5, seed * 7 + 1, FUGITIVE, colliders, null);
  if (fast) fd.setChase(true);
  // La police part d'une arête à 120-250 m.
  let start = -1;
  for (let k = 0; k < list.length; k++) {
    const m = list[(seed * 13 + k) % list.length]!;
    lanePoint(nav.road, m, 5, lp);
    const d = Math.hypot(lp.x - fug.x, lp.y - fug.y);
    if (d > 120 && d < 250 && moveEdge(m) !== moveEdge(from)) {
      start = m;
      break;
    }
  }
  const sim = new TrafficSim(nav, world.terrain, colliders);
  const cop = sim.add(POLICE, start, 5, seed, 0);
  sim.setChase(cop, true);
  const run: Run = { closest: Infinity, near: 0, reverses: 0, plans: 0, failures: 0, held: Infinity, contacts: 0, contactsStopped: 0 };
  let nearSteps = 0, counted = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    // Arrêt : frein, puis frein à main (le frein à l'arrêt ferait reculer, D27).
    const input = t >= stopAt ? { throttle: 0, brake: fug.speed > 0.3 ? 1 : 0, steer: 0, handbrake: fug.speed > 0.3 ? 0 : 1 } : fd.update(fug, DT, [cop.other]);
    if (fd.lost && t < stopAt) {
      const h = nav.road.nearest(fug.x, fug.y, 30);
      if (h) fd.restart(h.edge * 2, h.s);
    }
    stepVehicle(fug, FUGITIVE, input, DT, world.terrain, colliders);
    sim.step(DT, { kind: "vehicle", state: fug, spec: FUGITIVE });
    if (t < stopAt) run.contacts += sim.stats.contacts > 0 ? 1 : 0;
    else run.contactsStopped += sim.stats.contacts > 0 ? 1 : 0;
    const d = Math.hypot(cop.state.x - fug.x, cop.state.y - fug.y);
    run.closest = Math.min(run.closest, d);
    if (t > 60 && t < stopAt) {
      counted++;
      if (d < 60) nearSteps++;
    }
  }
  run.near = counted ? nearSteps / counted : 0;
  run.reverses = cop.chase!.reverses;
  run.plans = cop.chase!.plans;
  run.failures = cop.chase!.planFailures;
  run.held = Math.hypot(cop.state.x - fug.x, cop.state.y - fug.y);
  return run;
}

describe("poursuite (J4-3)", () => {
  // Mesure (D73, vraies données, 6 départs) : contre un fugitif qui roule comme la circulation, la gendarmerie arrive à moins de 8 m de lui
  // et s'arrête à 4 à 8 m quand il s'arrête ; contre un fugitif aussi rapide qu'elle (conduite de poursuite), elle le perd parfois.
  it("rattrape un fugitif qui roule comme la circulation, et s'arrête près de lui sans le toucher quand il s'arrête", () => {
    let caught = 0, held = 0, failures = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = chase(seed, 200, 120, false);
      expect(Number.isFinite(r.closest)).toBe(true);
      if (r.closest < 8) caught++;
      if (r.held < 12 && r.contactsStopped === 0) held++;
      failures += r.failures;
    }
    expect(caught).toBeGreaterThanOrEqual(5);
    expect(held).toBeGreaterThanOrEqual(5);
    expect(failures).toBe(0);
  }, 120000);

  it("une voiture de la circulation devant une gendarmerie en poursuite se range à droite et ralentit ; sans poursuite, rien", () => {
    // Une longue arête droite de route principale.
    const move = starts(1, 150, 2).find((m) => nav.road.edgeWidth(moveEdge(m)) >= 7)!;
    expect(move).toBeDefined();
    for (const chasing of [true, false]) {
      const sim = new TrafficSim(nav, world.terrain, colliders);
      const civ = sim.add(FUGITIVE, move, 45, 3, 9);
      const cop = sim.add(POLICE, move, 5, 4, 14);
      if (chasing) sim.setChase(cop, true);
      // Le fugitif est loin devant, au bout de l'arête.
      const far = { x: 0, y: 0, heading: 0 };
      lanePoint(nav.road, move, nav.road.edgeLength(moveEdge(move)), far);
      let slowest = Infinity;
      for (let i = 0; i < 60 * 4; i++) {
        sim.step(DT, { kind: "foot", x: far.x, y: far.y, vx: 0, vy: 0 });
        if (i > 60 * 2) slowest = Math.min(slowest, civ.state.speed);
      }
      if (chasing) expect(slowest).toBeLessThan(2.6);
      else expect(slowest).toBeGreaterThan(4);
    }
  });

  it("quatre gendarmeries qui poursuivent un point qui roule (comme le banc, sans corps) ne s'empilent pas : D79, avant les places autour de la cible, 17 248 pas avec contact sur 26 396 (65 %)", () => {
    let contact = 0, close = 0, steps = 0;
    for (const seed of [2, 3, 4, 5]) {
      const list = starts(4), from = list[(seed * 17) % list.length]!;
      const lp = { x: 0, y: 0, heading: 0 };
      lanePoint(nav.road, from, 5, lp);
      const car = createVehicle(lp.x, lp.y, lp.heading, world.terrain);
      const fd = new Driver(nav, from, 5, seed, FUGITIVE, colliders, null);
      const sim = new TrafficSim(nav, world.terrain, colliders);
      // Quatre voitures de police à 70 à 200 m, comme des renforts.
      let placed = 0;
      for (let k = 0; k < list.length && placed < 4; k++) {
        const m = list[(seed * 13 + k * 7) % list.length]!;
        lanePoint(nav.road, m, 5, lp);
        const d = Math.hypot(lp.x - car.x, lp.y - car.y);
        if (d > 70 && d < 200) {
          sim.setChase(sim.add(POLICE, m, 5, seed * 10 + placed, 0), true);
          placed++;
        }
      }
      for (let i = 0; i < 150 * 60; i++) {
        const input = fd.update(car, DT, []);
        if (fd.lost) {
          const h = nav.road.nearest(car.x, car.y, 30);
          if (h) fd.restart(h.edge * 2, h.s);
        }
        stepVehicle(car, FUGITIVE, input, DT, world.terrain, colliders);
        sim.chaseTarget = { x: car.x, y: car.y, vx: car.vx, vy: car.vy };
        sim.step(DT, null);
        if (i <= 60 * 40) continue;
        steps++;
        if (sim.stats.contacts > 0) contact++;
        let near = false;
        for (let a = 0; a < sim.cars.length; a++) for (let b = a + 1; b < sim.cars.length; b++) if (Math.hypot(sim.cars[a]!.state.x - sim.cars[b]!.state.x, sim.cars[a]!.state.y - sim.cars[b]!.state.y) < 3) near = true;
        if (near) close++;
      }
    }
    expect(steps).toBeGreaterThan(20000);
    expect(contact / steps).toBeLessThan(0.1);
    expect(close / steps).toBeLessThan(0.03);
  }, 120000);

  it("contre un fugitif aussi rapide qu'elle, elle le retrouve le plus souvent une fois qu'il s'est arrêté", () => {
    let held = 0;
    for (let seed = 1; seed <= 6; seed++) if (chase(seed, 200, 120, true).held < 12) held++;
    expect(held).toBeGreaterThanOrEqual(4);
  }, 120000);
});
