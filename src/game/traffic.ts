import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { lanePoint } from "../core/driver";
import { moveEdge } from "../core/road-graph";
import type { Signals } from "../core/signals";
import type { TrafficBody } from "../core/pedestrians";
import { TrafficSim, type PedLookup, type PlayerBody, type SimCar } from "../core/traffic-sim";
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
  sim: SimCar;
  def: VehicleDef;
  model: VehicleModel;
  /** Ce que voient les passants de cette voiture (position, vitesse, coque) et ce que le choc d'un passant lui a coûté. */
  body: TrafficBody;
}

/** Distance (m) du joueur à laquelle on place une voiture : ni dans son champ de vision immédiat, ni hors de la navigation chargée. */
const SPAWN_MIN = 45;
const SPAWN_MAX = 170;

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private readonly sim: TrafficSim;
  /** Coût moyen (ms, lissé) d'un pas de simulation de toutes les voitures, pour la ligne de diagnostic. */
  simMs = 0;
  private serial = 0;
  private cooldown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    terrain: HeightField,
    colliders: Colliders,
    private readonly solidAt: (x: number, y: number) => boolean,
    private capacity: number,
    signals: Signals,
    private readonly seed = 1,
  ) {
    this.sim = new TrafficSim(nav.graph, terrain, colliders, signals);
  }

  /** Contacts de la circulation au dernier pas (voitures entre elles, avec le joueur). */
  get stats(): TrafficSim["stats"] {
    return this.sim.stats;
  }

  /** Les passants : les voitures les évitent et s'arrêtent pour ceux qui traversent. */
  setPeds(peds: PedLookup | null): void {
    this.sim.peds = peds;
  }

  /** Les voitures telles que les passants les voient (`Observer.vehicles`), à jour de leur position. */
  bodies(): readonly TrafficBody[] {
    this.bodyList.length = 0;
    for (const c of this.cars) {
      const s = c.sim.state, b = c.body;
      b.x = s.x;
      b.y = s.y;
      b.vx = s.vx;
      b.vy = s.vy;
      b.heading = s.heading;
      b.slow = b.speed = b.hits = 0;
      this.bodyList.push(b);
    }
    return this.bodyList;
  }

  /** Après la simulation des passants : une voiture qui a heurté un passant perd 10 à 30 % de sa vitesse (D44, comme le véhicule du joueur). */
  applyImpacts(): void {
    for (const c of this.cars) {
      if (c.body.slow <= 0) continue;
      const keep = 1 - c.body.slow, s = c.sim.state;
      s.vx *= keep;
      s.vy *= keep;
      s.speed *= keep;
    }
  }

  private readonly bodyList: TrafficBody[] = [];

  setCapacity(n: number): void {
    this.capacity = n;
    while (this.cars.length > n) this.remove(this.cars.length - 1);
  }

  /** Un pas de simulation à pas fixe : conducteurs, physique et chocs. `player` : ce que les conducteurs voient du joueur. */
  step(dt: number, player: PlayerBody | null): void {
    if (this.cars.length === 0) return;
    const t0 = performance.now();
    this.sim.step(dt, player);
    this.simMs += (performance.now() - t0 - this.simMs) * 0.02;
  }

  /** À chaque image : modèles, remplacement des voitures perdues, naissances. */
  update(dt: number, px: number, py: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      c.model.update(c.sim.state);
      // Perdue, ou restée loin derrière : elle disparaît.
      if (c.sim.driver?.lost || Math.hypot(c.sim.state.x - px, c.sim.state.y - py) > SPAWN_MAX * 2) this.remove(i);
    }
    this.cooldown -= dt;
    if (this.cars.length < this.capacity && this.cooldown <= 0 && this.nav.graph.cells.size > 0) {
      this.cooldown = 0.3;
      this.spawn(px, py);
    }
  }

  private remove(i: number): void {
    const c = this.cars[i]!;
    const k = this.sim.cars.indexOf(c.sim);
    if (k >= 0) this.sim.remove(k);
    this.scene.remove(c.model.group);
    c.model.dispose();
    this.cars.splice(i, 1);
  }

  private spawn(px: number, py: number): void {
    const graph = this.nav.graph, road = graph.road;
    const rnd = (n: number): number => {
      let h = Math.imul((this.seed + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(this.serial * 8 + n + 1, 0xc2b2ae35);
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
    const s = Math.min(road.edgeLength(moveEdge(move)) / 2, 12);
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(road, move, s, lp);
    // Pas sur une autre voiture.
    if (this.cars.some((c) => Math.hypot(c.sim.state.x - lp.x, c.sim.state.y - lp.y) < 10)) return;
    const cars = CATALOG.filter((d) => d.family === "car");
    const def = cars.find((d) => d.id === pickModel("car", 0, rnd(2))) ?? cars[0]!;
    const variant = Math.floor(rnd(3) * 16);
    const sim = this.sim.add(def.spec, move, s, Math.floor(rnd(4) * 1e9));
    const model = buildModel(def, variant);
    model.update(sim.state);
    this.scene.add(model.group);
    this.cars.push({ sim, def, model, body: { x: 0, y: 0, vx: 0, vy: 0, heading: 0, hull: def.spec.hull, slow: 0, speed: 0, hits: 0 } });
  }

  dispose(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) this.remove(i);
  }
}
