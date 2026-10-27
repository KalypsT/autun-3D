import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { Driver, lanePoint } from "../core/driver";
import { moveEdge } from "../core/road-graph";
import { createVehicle, stepVehicle, type VehicleState } from "../core/vehicle";
import { CATALOG, type VehicleDef } from "../core/vehicle-catalog";
import { pickModel } from "../core/vehicle-placement";
import type { HeightField } from "../data/types";
import type { VehicleModel } from "../render/vehicle-model";
import type { NavManager } from "./nav-manager";
import { buildModel } from "./vehicles";

/**
 * Circulation (étape J3). Première version (J3-1) : des voitures qui roulent seules sur les routes autour du joueur, chacune avec son
 * conducteur (`src/core/driver.ts`) et son modèle articulé. `?traffic=N` en met N ; une voiture perdue (impasse, blocage) est remplacée.
 * Les règles de circulation, la naissance et la mort selon l'heure et le rendu par instances viennent dans les étapes suivantes (D58).
 */

interface TrafficCar {
  def: VehicleDef;
  state: VehicleState;
  driver: Driver;
  model: VehicleModel;
}

/** Distance (m) du joueur à laquelle on place une voiture : ni dans son champ de vision immédiat, ni hors de la navigation chargée. */
const SPAWN_MIN = 45;
const SPAWN_MAX = 170;

export class Traffic {
  readonly cars: TrafficCar[] = [];
  /** Coût moyen (ms, lissé) d'un pas de simulation de toutes les voitures, pour la ligne de diagnostic. */
  simMs = 0;
  private serial = 0;
  private cooldown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    private readonly solidAt: (x: number, y: number) => boolean,
    private capacity: number,
    private readonly seed = 1,
  ) {}

  setCapacity(n: number): void {
    this.capacity = n;
    while (this.cars.length > n) this.remove(this.cars.length - 1);
  }

  /** Un pas de simulation à pas fixe : conducteurs puis physique. */
  step(dt: number): void {
    if (this.cars.length === 0) return;
    const t0 = performance.now();
    for (const c of this.cars) {
      const input = c.driver.update(c.state, dt);
      stepVehicle(c.state, c.def.spec, input, dt, this.terrain, this.colliders);
    }
    this.simMs += (performance.now() - t0 - this.simMs) * 0.02;
  }

  /** À chaque image : modèles, remplacement des voitures perdues, naissances. */
  update(dt: number, px: number, py: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      c.model.update(c.state);
      // Perdue, ou restée loin derrière : elle disparaît.
      if (c.driver.lost || Math.hypot(c.state.x - px, c.state.y - py) > SPAWN_MAX * 2) this.remove(i);
    }
    this.cooldown -= dt;
    if (this.cars.length < this.capacity && this.cooldown <= 0 && this.nav.graph.cells.size > 0) {
      this.cooldown = 0.3;
      this.spawn(px, py);
    }
  }

  private remove(i: number): void {
    const c = this.cars[i]!;
    this.scene.remove(c.model.group);
    c.model.dispose();
    this.cars.splice(i, 1);
  }

  private spawn(px: number, py: number): void {
    const graph = this.nav.graph, road = graph.road;
    const rnd = (n: number): number => {
      let h = Math.imul((this.seed + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(this.serial * 2 + n + 1, 0xc2b2ae35);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
    };
    const candidates: number[] = [];
    const mid = { x: 0, y: 0 };
    for (const l of graph.cells.values()) {
      for (const e of road.edgesOfSlot(l.slot)) {
        if (!road.drivable(e) || road.edgeLength(e) < 25 || road.edgeClass(e) > 5) continue;
        if ((road.nodeFlags(road.edgeA(e)) | road.nodeFlags(road.edgeB(e))) & 2) continue;
        road.pointAt(e, road.edgeLength(e) / 2, mid);
        const d = Math.hypot(mid.x - px, mid.y - py);
        if (d < SPAWN_MIN || d > SPAWN_MAX || !this.solidAt(mid.x, mid.y)) continue;
        candidates.push(e);
      }
    }
    this.serial++;
    if (candidates.length === 0) return;
    const e = candidates[Math.floor(rnd(0) * candidates.length)]!;
    let move = e * 2 + (rnd(1) < 0.5 ? 0 : 1);
    if (!road.canGo(move)) move ^= 1;
    if (!road.canGo(move)) return;
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(road, move, Math.min(road.edgeLength(moveEdge(move)) / 2, 12), lp);
    // Pas sur une autre voiture.
    if (this.cars.some((c) => Math.hypot(c.state.x - lp.x, c.state.y - lp.y) < 8)) return;
    const cars = CATALOG.filter((d) => d.family === "car");
    const def = cars.find((d) => d.id === pickModel("car", 0, rnd(2))) ?? cars[0]!;
    const variant = Math.floor(rnd(3) * 16);
    const state = createVehicle(lp.x, lp.y, lp.heading, this.terrain);
    const driver = new Driver(graph, move, Math.min(road.edgeLength(moveEdge(move)) / 2, 12), Math.floor(rnd(4) * 1e9), def.spec, this.colliders);
    const model = buildModel(def, variant);
    model.update(state);
    this.scene.add(model.group);
    this.cars.push({ def, state, driver, model });
  }

  dispose(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) this.remove(i);
  }
}
