import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import type { Other } from "../core/driver";
import type { TrafficBody } from "../core/pedestrians";
import { AMBER, RED, type Signals } from "../core/signals";
import type { RoadGraph } from "../core/road-graph";
import type { VehicleSpec, VehicleState } from "../core/vehicle";
import { carPoses, LOCO, TRAIN, trainShown, TrainSim, type CarPose, type TrainView } from "../core/tourist-train";
import { TrainRoute } from "../core/train-route";
import { applyAppearance, recipeFromSeed, WHITE } from "../core/character";
import type { HeightField } from "../data/types";
import { createPlayerModel } from "../render/player-model";
import { TrainModel, TRAIN_BODY } from "../render/train-model";

/**
 * Petit train touristique dans le jeu (D117) : la marche (`TrainSim`), le dessin, le conducteur, et la place du train parmi les autres.
 * Ce n'est pas un véhicule de la flotte : on ne le prend pas (étape suivante). Il est un obstacle (cercles de collision recalculés à chaque
 * image : le joueur, les voitures et les passants butent dessus), la circulation le voit comme une voiture, les passants l'évitent ;
 * lui s'arrête devant ce qui est sur sa voie, au feu rouge, et une minute au départ à chaque tour.
 */

/** Ce que le jeu donne au train à chaque image. */
export interface TrainEnv {
  x: number;
  y: number;
  hour: number;
  /** Le joueur : son véhicule (état et fiche) ou lui-même à pied. */
  vehicle: { state: VehicleState; spec: VehicleSpec } | null;
  /** Voitures de la circulation, passants, véhicules déplacés de la flotte, feux et rues chargées (null : pas encore là). */
  cars: readonly { state: VehicleState; spec: VehicleSpec }[];
  peds: { forEachNear(x: number, y: number, r: number, visit: (x: number, y: number, vx: number, vy: number, engaged: boolean) => void): void } | null;
  parked: readonly { state: VehicleState; spec: VehicleSpec }[];
  road: RoadGraph | null;
  signals: Signals | null;
}

/** Au-delà de cette distance du joueur (m), le train roule seul : ni obstacle, ni feu (personne ne le voit s'arrêter). */
const AWARE = 250;
/** Distance (m) devant l'essieu avant où le train regarde, et largeur de sa voie de chaque côté de l'axe (m). */
const LOOK = 35;
const LANE = LOCO.halfWidth + 0.25;
/** Rien ne se gare à moins de tant du circuit (m) : la voie du train, plus une demi-voiture (une place est repérée par son centre). */
export const TRAIN_CLEAR = LANE + 2.4;
/** Coincé par une voiture de la circulation plus de tant (s) : il avance au pas en la poussant (deux véhicules qui s'attendent face à face). */
const STUCK = 15;
const COLLIDER_TAG = "train";

export class TouristTrain {
  readonly route = new TrainRoute();
  readonly sim: TrainSim;
  private readonly model: TrainModel;
  private readonly driver = createPlayerModel(applyAppearance(recipeFromSeed(20240611), { topColor: WHITE, hat: "cap" }));
  private readonly poses: CarPose[] = [];
  private shown: boolean | null = null;
  /** La circulation voit chaque voiture du train comme une voiture (`TrafficSim.extra`), les passants aussi (`Observer.vehicles`). */
  readonly others: Other[] = [];
  readonly bodies: TrafficBody[] = [];
  private stuck = 0;
  private readonly edges: number[] = [];
  private push = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly colliders: Colliders,
    private readonly terrain: HeightField,
    start = 0,
  ) {
    this.sim = new TrainSim(this.route, start);
    this.model = new TrainModel(TRAIN.cars);
    for (let i = 0; i < TRAIN.cars.length; i++) {
      const c = TRAIN.cars[i]!;
      this.others.push({ state: { x: 0, y: 0, vx: 0, vy: 0, heading: 0 }, halfLen: c.wheelbase / 2 + c.overhang, halfWid: c.halfWidth });
      this.bodies.push({ x: 0, y: 0, vx: 0, vy: 0, heading: 0, hull: [[0, c.halfWidth]], slow: 0, speed: 0, hits: 0 });
    }
  }

  /** Le train est-il dans le monde (montré) ? */
  get visible(): boolean {
    return this.shown === true;
  }

  /** Position de la locomotive (diagnostic, captures). */
  get position(): { x: number; y: number } {
    const p = this.poses[0];
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  }

  update(dt: number, env: TrainEnv): void {
    carPoses(this.route, this.sim.s, this.poses);
    const loco = this.poses[0]!;
    const dist = Math.hypot(loco.x - env.x, loco.y - env.y);
    const shown = trainShown(this.shown, env.hour, dist);
    if (shown !== this.shown) {
      this.shown = shown;
      if (shown) this.scene.add(this.model.group, this.driver.group);
      else {
        this.scene.remove(this.model.group, this.driver.group);
        this.colliders.removeTag(COLLIDER_TAG);
      }
    }
    // Loin du joueur, ou caché : il roule seul. Près de lui : obstacles et feux.
    const aware = shown && dist < AWARE;
    this.sim.update(dt, aware ? this.view(env, dt) : undefined);
    carPoses(this.route, this.sim.s, this.poses);
    if (!shown) return;
    this.model.update(this.poses, (x, y) => this.terrain.heightAt(x, y), this.sim.wheel);
    this.placeDriver();
    this.colliders.removeTag(COLLIDER_TAG);
    this.colliders.currentTag = COLLIDER_TAG;
    const v = this.sim.speed;
    this.poses.forEach((p, i) => {
      const c = TRAIN.cars[i]!, fx = Math.sin(p.heading), fy = Math.cos(p.heading), half = c.wheelbase / 2 + c.overhang;
      // Deux cercles par caisse, de la largeur du train.
      for (const k of [-1, 1]) this.colliders.addCircle(p.x + fx * k * (half - c.halfWidth), p.y + fy * k * (half - c.halfWidth), c.halfWidth);
      const o = this.others[i]!.state;
      o.x = p.x;
      o.y = p.y;
      o.vx = fx * v;
      o.vy = fy * v;
      o.heading = p.heading;
      const b = this.bodies[i]!;
      b.x = p.x;
      b.y = p.y;
      b.vx = fx * v;
      b.vy = fy * v;
      b.heading = p.heading;
      b.hull = [[half - c.halfWidth, c.halfWidth], [-(half - c.halfWidth), c.halfWidth]];
      b.slow = b.speed = b.hits = 0;
    });
    this.colliders.currentTag = null;
  }

  /** Le conducteur, debout dans la cabine, face à la route. */
  private placeDriver(): void {
    const p = this.poses[0]!, fx = Math.sin(p.heading), fy = Math.cos(p.heading), back = 1.1;
    const x = p.x - fx * back, y = p.y - fy * back;
    this.driver.update(x, y, this.terrain.heightAt(x, y) + TRAIN_BODY.loco.floor, p.heading, 0, 0);
  }

  /** Ce que le train voit devant lui : le premier obstacle sur sa voie, et l'état des feux. */
  private view(env: TrainEnv, dt: number): TrainView {
    const pt = { x: 0, y: 0, heading: 0 }, s0 = this.sim.s;
    const lx = this.poses[0]!.x, ly = this.poses[0]!.y;
    let obstacle = Infinity, byCar = false;
    // Échantillons de la voie devant l'essieu avant, tous les mètres.
    const samples: number[] = [];
    for (let d = 0; d <= LOOK; d += 1) {
      this.route.at(s0 + d, pt);
      samples.push(pt.x, pt.y);
    }
    const hit = (x: number, y: number, r: number): number => {
      if (Math.abs(x - lx) > LOOK + 10 || Math.abs(y - ly) > LOOK + 10) return Infinity;
      for (let k = 0; k < samples.length / 2; k++) if (Math.hypot(samples[2 * k]! - x, samples[2 * k + 1]! - y) < LANE + r) return k;
      return Infinity;
    };
    const hull = (state: VehicleState, spec: VehicleSpec): number => {
      let best = Infinity;
      for (const [off, r] of spec.hull) best = Math.min(best, hit(state.x + Math.sin(state.heading) * off, state.y + Math.cos(state.heading) * off, r));
      return best;
    };
    if (this.push <= 0) {
      for (const c of env.cars) {
        const d = hull(c.state, c.spec);
        if (d < obstacle) {
          obstacle = d;
          byCar = true;
        }
      }
    }
    for (const c of env.parked) obstacle = Math.min(obstacle, hull(c.state, c.spec));
    if (env.vehicle) {
      const d = hull(env.vehicle.state, env.vehicle.spec);
      if (d < obstacle) [obstacle, byCar] = [d, false];
    } else {
      const d = hit(env.x, env.y, 0.4);
      if (d < obstacle) [obstacle, byCar] = [d, false];
    }
    env.peds?.forEachNear(lx, ly, LOOK + 5, (x, y) => {
      const d = hit(x, y, 0.35);
      if (d < obstacle) [obstacle, byCar] = [d, false];
    });
    // Face à face avec une voiture qui attend aussi : au bout d'un moment, le train avance au pas et la pousse (il est bien plus lourd).
    if (byCar && this.sim.speed < 0.1 && obstacle < 10) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > STUCK) {
      this.push = 6;
      this.stuck = 0;
    }
    this.push = Math.max(0, this.push - dt);
    return { obstacle, stopAt: (i) => this.mustStop(i, env) };
  }

  /** Le feu `i` du circuit commande-t-il l'arrêt ? Rouge, ou orange quand on peut encore s'arrêter ; null si les rues ne sont pas chargées. */
  private mustStop(i: number, env: TrainEnv): boolean | null {
    const road = env.road, signals = env.signals, sig = this.route.signals[i];
    if (!road || !signals || !sig) return null;
    const at = road.nearest(sig.x, sig.y, 3);
    if (!at) return null;
    let node = -1;
    for (const end of [0, 1] as const) {
      const n = road.edgeNode(at.edge, end);
      if (signals.hasSignal(n) && Math.hypot(road.nodeX(n) - sig.x, road.nodeY(n) - sig.y) < 1) node = n;
    }
    if (node < 0) return null;
    // L'arête par laquelle le train arrive : parmi celles du nœud, celle qui y arrive dans la direction du train (plusieurs feux d'un même
    // carrefour sont à quelques mètres les uns des autres : chercher la rue sous le tracé, juste avant, tombe souvent sur la mauvaise).
    const dir = this.route.at(sig.s - 2, { x: 0, y: 0, heading: 0 }).heading, fx = Math.sin(dir), fy = Math.cos(dir);
    this.edges.length = 0;
    road.edgesAt(node, this.edges);
    let m = -1, best = 0.3;
    for (const e of this.edges) {
      const into = road.edgeB(e) === node, from = road.edgeNode(e, into ? 0 : 1);
      const dx = road.nodeX(node) - road.nodeX(from), dy = road.nodeY(node) - road.nodeY(from), len = Math.hypot(dx, dy);
      const dot = len > 0 ? (dx * fx + dy * fy) / len : 0;
      if (dot > best) {
        best = dot;
        m = into ? e * 2 : e * 2 + 1;
      }
    }
    if (m < 0) return null;
    const state = signals.carState(m);
    if (state === RED) return true;
    // À l'orange, il passe s'il est déjà trop près pour s'arrêter en douceur.
    if (state === AMBER) return sig.s - this.sim.s - TRAIN.signalStop > (this.sim.speed * this.sim.speed) / (2 * TRAIN.brake);
    return false;
  }

  dispose(): void {
    this.scene.remove(this.model.group, this.driver.group);
    this.colliders.removeTag(COLLIDER_TAG);
    this.model.dispose();
    this.driver.dispose();
  }
}
