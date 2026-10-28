import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealNav, loadRealWorld } from "../core/testing";
import { Signals } from "../core/signals";
import { trafficTarget } from "../core/traffic-density";
import { buildColliders } from "../core/world";
import { NavManager } from "./nav-manager";
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
    expect(scene.children.length).toBe(traffic.cars.length);
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
});
