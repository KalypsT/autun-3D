import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../core/vehicle-catalog";
import { loadRealNav, loadRealWorld } from "../core/testing";
import { Signals } from "../core/signals";
import { trafficTarget } from "../core/traffic-density";
import { buildColliders } from "../core/world";
import { NavManager } from "./nav-manager";
import { PedSim, type Observer } from "../core/pedestrians";
import { Traffic, type TrafficEnv } from "./traffic";
import { visibleFrom } from "../core/traffic-spawn";

const world = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(world.tile);

function make(capacity: number): { traffic: Traffic; nav: NavManager; scene: THREE.Scene } {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const scene = new THREE.Scene();
  const traffic = new Traffic(scene, nav, world.terrain, colliders, () => true, capacity, new Signals(nav.graph.road, { t: 0 }), 11);
  return { traffic, nav, scene };
}

const DT = 1 / 60;
const env = (over: Partial<TrafficEnv> = {}): TrafficEnv => ({ x: 0, y: 0, yaw: 0, speed: 0, hour: 8, vehicle: null, ...over });

describe("circulation du jeu : naissance et disparition (J3-4)", () => {
  it("remplit la couronne jusqu'à la cible de l'heure, sans la dépasser, et ne fait naître personne dans le champ de vision", () => {
    const { traffic } = make(20);
    let max = 0, inView = 0;
    for (let k = 0; k < 60 * 60; k++) {
      const e = env();
      traffic.step(DT, { kind: "foot", x: 0, y: 0, vx: 0, vy: 0 });
      const before = new Set(traffic.cars);
      traffic.update(DT, e);
      max = Math.max(max, traffic.cars.length);
      for (const c of traffic.cars) {
        if (before.has(c)) continue;
        // Naissance de cette image : jamais à découvert dans le champ de vision.
        if (visibleFrom(e.x, e.y, e.yaw, 0.95, c.sim.state.x, c.sim.state.y, colliders)) inView++;
      }
    }
    // Au centre à 8 h : la cible vaut la capacité.
    expect(traffic.target).toBe(trafficTarget(20, 8, traffic.zone, 0));
    expect(max).toBeLessThanOrEqual(20);
    expect(traffic.cars.length).toBeGreaterThanOrEqual(traffic.target - 2);
    expect(inView).toBe(0);
    traffic.dispose();
  });

  it("la nuit, la circulation se réduit à la cible nocturne : les voitures en surnombre sont retirées hors de la vue", () => {
    const { traffic } = make(20);
    for (let k = 0; k < 60 * 45; k++) {
      traffic.step(DT, { kind: "foot", x: 0, y: 0, vx: 0, vy: 0 });
      traffic.update(DT, env({ hour: 8 }));
    }
    const day = traffic.cars.length;
    expect(day).toBeGreaterThan(8);
    for (let k = 0; k < 60 * 120; k++) {
      traffic.step(DT, { kind: "foot", x: 0, y: 0, vx: 0, vy: 0 });
      traffic.update(DT, env({ hour: 3 }));
    }
    const night = traffic.cars.length;
    expect(traffic.target).toBe(trafficTarget(20, 3, traffic.zone, 0));
    expect(night).toBeLessThan(day);
    expect(night).toBeLessThanOrEqual(traffic.target + 3);
    traffic.dispose();
  });

  it("suit un joueur qui roule : les voitures lointaines disparaissent, d'autres naissent devant, le nombre reste borné, aucune fuite de modèles", () => {
    const { traffic, scene } = make(15);
    let x = -400, maxCars = 0;
    for (let k = 0; k < 60 * 90; k++) {
      x += 12 * DT;
      traffic.step(DT, { kind: "foot", x, y: 0, vx: 12, vy: 0 });
      traffic.update(DT, env({ x, y: -200, yaw: Math.PI / 2, speed: 12 }));
      maxCars = Math.max(maxCars, traffic.cars.length);
    }
    expect(maxCars).toBeLessThanOrEqual(15);
    // Toutes les voitures vivantes sont dans la couronne élargie, et la scène ne garde que leurs modèles.
    for (const c of traffic.cars) expect(Math.hypot(c.sim.state.x - x, c.sim.state.y + 200)).toBeLessThan(450);
    expect(scene.children.length).toBe(1);
    expect(traffic.models.instances).toBe(traffic.cars.length);
    traffic.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("une capacité de 0 vide la circulation, et la remettre la refait naître", () => {
    const { traffic } = make(10);
    for (let k = 0; k < 60 * 30; k++) traffic.update(DT, env());
    expect(traffic.cars.length).toBeGreaterThan(0);
    traffic.setCapacity(0);
    traffic.update(DT, env());
    expect(traffic.cars.length).toBe(0);
    traffic.setCapacity(10);
    for (let k = 0; k < 60 * 30; k++) traffic.update(DT, env());
    expect(traffic.cars.length).toBeGreaterThan(0);
    traffic.dispose();
  });

  it("patrouilles de gendarmerie (J4) : il en naît dans la circulation ordinaire, jamais plus d'une à la fois, gyrophares éteints", () => {
    const { traffic } = make(20);
    let seen = 0, most = 0;
    const ids = new Set<unknown>();
    // Le joueur roule vers l'est puis revient : les voitures se renouvellent.
    for (let k = 0; k < 60 * 240; k++) {
      const t = k / 60, x = 400 * Math.sin(t / 40);
      traffic.step(DT, { kind: "foot", x, y: 0, vx: 0, vy: 0 });
      traffic.update(DT, env({ x, speed: 10 * Math.abs(Math.cos(t / 40)), yaw: Math.cos(t / 40) >= 0 ? Math.PI / 2 : -Math.PI / 2 }));
      most = Math.max(most, traffic.policeCount);
      for (const c of traffic.cars) if (c.police && !ids.has(c)) {
        ids.add(c);
        seen++;
        expect(c.siren).toBe(false);
        expect(c.def.id).toBe("gendarmerie");
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(most).toBe(1);
    traffic.dispose();
  }, 60000);

  it("poursuite (J4-3) : les gendarmeries demandées naissent hors de vue, rejoignent le joueur à pied, gyrophares allumés (+3 maillages au plus), puis sont rappelées", () => {
    const { traffic } = make(10);
    const here = { x: -10, y: -40 };
    const step = (): void => {
      traffic.step(DT, { kind: "foot", x: here.x, y: here.y, vx: 0, vy: 0 });
      traffic.update(DT, env({ ...here, hour: 22 }));
    };
    for (let k = 0; k < 60 * 20; k++) step();
    const quiet = traffic.models.drawn - (traffic.policeCount > 0 ? 1 : 0);
    traffic.pursuers = 2;
    let closest = Infinity;
    for (let k = 0; k < 60 * 90; k++) {
      step();
      for (const c of traffic.cars) if (c.sim.chase) closest = Math.min(closest, Math.hypot(c.sim.state.x - here.x, c.sim.state.y - here.y));
    }
    expect(traffic.chasing).toBe(2);
    for (const c of traffic.cars) if (c.sim.chase) expect(c.siren && c.police).toBe(true);
    expect(closest).toBeLessThan(15);
    // Coût : le modèle de la gendarmerie et le maillage des gyrophares, rien de plus (les civils présents peuvent avoir changé de modèles).
    expect(traffic.models.drawn).toBeLessThanOrEqual(quiet + 3);
    // La circulation garde son plafond : les poursuivants y comptent.
    expect(traffic.cars.length).toBeLessThanOrEqual(Math.max(10, traffic.target) + 2);
    traffic.pursuers = 0;
    for (let k = 0; k < 60; k++) step();
    expect(traffic.chasing).toBe(0);
    for (const c of traffic.cars) expect(c.siren).toBe(false);
    traffic.dispose();
  }, 60000);

  it("`extract` retire la voiture la plus proche de la circulation et de l'écran, et rend de quoi en faire un véhicule de la flotte (J4 : vol)", () => {
    const { traffic } = make(10);
    for (let k = 0; k < 60 * 30; k++) {
      traffic.step(DT, { kind: "foot", x: 0, y: 0, vx: 0, vy: 0 });
      traffic.update(DT, env());
    }
    const n = traffic.cars.length;
    expect(n).toBeGreaterThan(3);
    expect(traffic.extract(1e5, 1e5, 50)).toBeNull();
    expect(traffic.cars.length).toBe(n);
    const target = traffic.cars[0]!.sim.state;
    const seen = traffic.nearest(target.x, target.y, 5)!;
    expect(seen.def).toBe(traffic.cars[0]!.def);
    expect(seen.distance).toBeLessThan(0.01);
    expect(seen.speed).toBeCloseTo(Math.hypot(target.vx, target.vy), 6);
    expect(traffic.nearest(1e5, 1e5, 50)).toBeNull();
    // Chaque voiture a son conducteur (graine de recette), différent d'une voiture à l'autre.
    expect(new Set(traffic.cars.map((c) => c.driver)).size).toBe(n);
    const driver = traffic.cars[0]!.driver;
    const got = traffic.extract(target.x, target.y, 5)!;
    expect(got.driver).toBe(driver);
    expect(got).not.toBeNull();
    expect(CATALOG.some((d) => d.id === got.model && d.family === "car")).toBe(true);
    expect(Number.isInteger(got.variant)).toBe(true);
    expect(Math.hypot(got.vx, got.vy)).toBeGreaterThan(0);
    expect(traffic.cars.length).toBe(n - 1);
    expect(traffic.models.instances).toBe(n - 1);
    traffic.dispose();
  });

  it("la nuit, 30 voitures et 100 passants à l'arrêt sur la place pendant 9 minutes : pas d'interblocage de voitures collées (D69, mesuré sur le téléphone : jusqu'à 2 325 pas de contact par minute)", () => {
    const { traffic, nav } = make(30);
    const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100, seed: 7 });
    peds.signals = new Signals(nav.graph.road, { t: 0 });
    traffic.setPeds(peds);
    const base: Observer = { x: -10, y: -40, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 22 };
    peds.prefill(base);
    let perMinute = 0, worstMinute = 0;
    for (let k = 1; k <= 60 * 60 * 9; k++) {
      traffic.step(DT, { kind: "foot", x: -10, y: -40, vx: 0, vy: 0 });
      traffic.update(DT, env({ x: -10, y: -40, hour: 22 }));
      peds.step(DT, { ...base, vehicles: traffic.bodies(), honks: traffic.takeHonks() });
      traffic.applyImpacts();
      if (traffic.stats.contacts > 0) perMinute++;
      if (k % 3600 === 0) {
        worstMinute = Math.max(worstMinute, perMinute);
        perMinute = 0;
      }
    }
    expect(traffic.cars.length).toBeGreaterThan(8);
    // Les premiers instants (naissances qui se croisent) comptent : le plafond est bien en dessous des 1 000 à 2 300 pas par minute mesurés avant la correction.
    expect(worstMinute).toBeLessThan(700);
    traffic.dispose();
  }, 120000);
});

