import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Driver, lanePoint } from "../core/driver";
import { OFFICER } from "../core/officers";
import { PedSim, type Observer } from "../core/pedestrians";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { createVehicle, stepVehicle } from "../core/vehicle";
import { vehicleDef } from "../core/vehicle-catalog";
import { Wanted } from "../core/wanted";
import { NavManager } from "./nav-manager";
import { PoliceController } from "./police";
import { Traffic } from "./traffic";

const { world, colliders, starts } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;
const CAR = vehicleDef("compacte")!.spec;

interface SoakMinute {
  chasing: number;
  officers: number;
  contacts: number;
  nearest: number;
  stars: number;
  arrests: number;
  /** Voiture de police la plus éloignée à la fin de la minute (m). */
  farthest: number;
}

/**
 * Endurance de la poursuite (D76) : « Dense » (30), 100 passants, feux, trois étoiles au départ (`stars`) ; un fugitif au volant (conducteur de poursuite : vite,
 * à contresens) roule `drive` s puis s'arrête et attend. Renvoie un relevé par minute et l'instant de l'arrestation (−1 sans).
 */
function soak(seed: number, drive: number, total: number, stars = 3): { minutes: SoakMinute[]; arrestedAt: number; bad: number; arrests: number; damage: number } {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 30, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed });
  peds.signals = signals;
  traffic.setPeds(peds);
  const wanted = new Wanted();
  const police = new PoliceController(wanted, colliders, () => nav.graph.road, () => signals, () => traffic);
  const list = starts(4);
  const from = list[(seed * 17) % list.length]!;
  const lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, from, 5, lp);
  const car = createVehicle(lp.x, lp.y, lp.heading, world.terrain);
  const fd = new Driver(nav.graph, from, 5, seed, CAR, colliders, null);
  fd.setChase(true);
  wanted.set(stars, car.x, car.y);
  const minutes: SoakMinute[] = [];
  let m: SoakMinute = { chasing: 0, officers: 0, contacts: 0, nearest: Infinity, stars: 0, arrests: 0, farthest: 0 };
  let arrestedAt = -1, bad = 0, arrests = 0, damage = 0;
  for (let i = 0; i < total * 60; i++) {
    const t = i * DT;
    const stopped = t >= drive;
    const input = stopped ? { throttle: 0, brake: car.speed > 0.3 ? 1 : 0, steer: 0, handbrake: car.speed > 0.3 ? 0 : 1 } : fd.update(car, DT, []);
    if (!stopped && fd.lost) {
      const h = nav.graph.road.nearest(car.x, car.y, 30);
      if (h) fd.restart(h.edge * 2, h.s);
    }
    stepVehicle(car, CAR, input, DT, world.terrain, colliders);
    traffic.step(DT, { kind: "vehicle", state: car, spec: CAR });
    traffic.update(DT, { x: car.x, y: car.y, yaw: car.heading, speed: Math.abs(car.speed), hour: 15, vehicle: { x: car.x, y: car.y } });
    const obs: Observer = { x: car.x, y: car.y, vx: car.vx, vy: car.vy, yaw: car.heading, onFoot: false, vehicle: { x: car.x, y: car.y, vx: car.vx, vy: car.vy, heading: car.heading, hull: CAR.hull }, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    police.update(DT, {
      x: car.x, y: car.y, vx: car.vx, vy: car.vy, heading: car.heading, speed: Math.abs(car.speed), driving: true, vehicle: { state: car, spec: CAR },
      pedHits: peds.impact.hits, pedHitSpeed: peds.impact.speed, witnesses: () => 0,
    });
    signals.clock.t += DT;
    damage += police.takeDamage();
    police.clearShots();
    if (police.takeArrest()) {
      if (arrestedAt < 0) arrestedAt = t;
      arrests++;
      m.arrests++;
      // On repart aussitôt avec le même nombre d'étoiles : l'endurance continue.
      police.reset();
      if (!stopped) wanted.set(stars, car.x, car.y);
    }
    if (!Number.isFinite(car.x + car.y)) bad++;
    m.chasing = Math.max(m.chasing, traffic.chasing);
    m.officers = Math.max(m.officers, police.officers.list.length);
    if (traffic.stats.contacts > 0) m.contacts++;
    traffic.forEachPolice((_id, x, y) => {
      if (!Number.isFinite(x + y)) bad++;
      m.nearest = Math.min(m.nearest, Math.hypot(x - car.x, y - car.y));
    });
    if ((i + 1) % 3600 === 0) {
      m.stars = wanted.stars;
      traffic.forEachPolice((_id, x, y) => {
        m.farthest = Math.max(m.farthest, Math.hypot(x - car.x, y - car.y));
      });
      minutes.push(m);
      m = { chasing: 0, officers: 0, contacts: 0, nearest: Infinity, stars: 0, arrests: 0, farthest: 0 };
    }
  }
  traffic.dispose();
  return { minutes, arrestedAt, bad, arrests, damage };
}

describe("poursuite qui dure (J4-6)", () => {
  // Mesure (D76) sur dix minutes : aucune valeur aberrante, poursuivants et gendarmes jamais au-delà de 4 et 6, arrestations, voitures de police
  // jamais à plus de 300 m en fin de minute. Le test garde six minutes et deux départs.
  it("« Dense », 100 passants, trois étoiles, un fugitif qui roule six minutes : rien d'aberrant, rien qui s'accumule, des arrestations", () => {
    let arrests = 0;
    for (const seed of [3, 8]) {
      const r = soak(seed, 360, 360);
      expect(r.bad).toBe(0);
      arrests += r.arrests;
      expect(r.minutes).toHaveLength(6);
      for (const q of r.minutes) {
        expect(q.chasing).toBeLessThanOrEqual(4);
        expect(q.officers).toBeLessThanOrEqual(OFFICER.max);
        expect(q.farthest).toBeLessThan(500);
        // Jamais collées une minute entière (D69 : jusqu'à 2 325 pas de contact par minute avant correction).
        expect(q.contacts).toBeLessThan(2700);
      }
      // À trois étoiles la police n'est pas armée : aucun point de vie perdu (J5-5).
      expect(r.damage).toBe(0);
    }
    expect(arrests).toBeGreaterThan(0);
  }, 600000);

  // Cinq étoiles (J5-4, D82) : six poursuivants au lieu de quatre ; mêmes critères, avec le nouveau plafond.
  it("cinq étoiles : six poursuivants au plus, six gendarmes à pied au plus, rien d'aberrant, rien qui s'accumule", () => {
    const r = soak(5, 240, 240, 5);
    expect(r.bad).toBe(0);
    expect(r.minutes).toHaveLength(4);
    let most = 0;
    for (const q of r.minutes) {
      most = Math.max(most, q.chasing);
      expect(q.chasing).toBeLessThanOrEqual(6);
      expect(q.officers).toBeLessThanOrEqual(OFFICER.max);
      expect(q.farthest).toBeLessThan(500);
      expect(q.contacts).toBeLessThan(2700);
    }
    expect(most).toBeGreaterThan(4);
    // Armée : les tirs des voitures et des gendarmes retirent des points de vie à un fugitif au volant, sans valeur aberrante (un joueur au volant en perd moitié moins, côté jeu).
    expect(r.damage).toBeGreaterThan(0);
    expect(Number.isFinite(r.damage)).toBe(true);
  }, 600000);
});
