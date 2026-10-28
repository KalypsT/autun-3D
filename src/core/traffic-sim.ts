import type { Colliders } from "./collision";
import { Driver, extentOf, lanePoint, type Other } from "./driver";
import type { NavGraph } from "./nav-graph";
import type { RoadMove } from "./road-graph";
import { createVehicle, stepVehicle, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";
import { contactVehicles } from "./vehicle-contact";
import type { HeightField } from "../data/types";

/**
 * Simulation de la circulation (J3-2) : logique pure. Des voitures, chacune avec son conducteur, qui se voient (suivi à distance de sécurité,
 * prudence face aux voitures en face), se heurtent quand elles se touchent, et voient aussi le joueur (au volant ou à pied).
 * Le jeu (`src/game/traffic.ts`) ajoute les modèles, la naissance et la mort ; les tests s'en servent tels quels.
 */

export interface SimCar {
  id: number;
  spec: VehicleSpec;
  state: VehicleState;
  /** Sans conducteur : une voiture arrêtée (essais), frein à main serré. */
  driver: Driver | null;
  other: Other;
  /** Âge (s) et pire impact reçu (m/s) depuis le dernier `step` (diagnostic). */
  age: number;
}

/** Ce que la circulation voit du joueur : le véhicule qu'il conduit (qui encaisse les chocs), ou lui-même à pied (obstacle, sans choc). */
export type PlayerBody = { kind: "vehicle"; state: VehicleState; spec: VehicleSpec } | { kind: "foot"; x: number; y: number; vx: number; vy: number };

const FOOT: Other["state"] = { x: 0, y: 0, vx: 0, vy: 0, heading: 0 };
const PARKED: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };

export class TrafficSim {
  readonly cars: SimCar[] = [];
  private serial = 0;
  private readonly others: Other[] = [];
  private playerOther: Other | null = null;
  private footOther: Other = { state: FOOT, halfLen: 0.4, halfWid: 0.4 };
  /** Contacts entre voitures et avec le joueur au dernier pas, et pire impact (m/s). */
  stats = { contacts: 0, worstImpact: 0 };

  constructor(
    private readonly nav: NavGraph,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
  ) {}

  /** Ajoute une voiture sur la voie de droite de `move`, à `s` m de son début, lancée à `speed` m/s ; sans graine, elle reste arrêtée. */
  add(spec: VehicleSpec, move: RoadMove, s: number, seed: number | null, speed = 0): SimCar {
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(this.nav.road, move, s, lp);
    const state = createVehicle(lp.x, lp.y, lp.heading, this.terrain);
    state.vx = Math.sin(lp.heading) * speed;
    state.vy = Math.cos(lp.heading) * speed;
    state.speed = speed;
    const driver = seed === null ? null : new Driver(this.nav, move, s, seed, spec, this.colliders);
    const { halfLen, halfWid } = extentOf(spec);
    const id = this.serial++;
    const car: SimCar = { id, spec, state, driver, other: { state, halfLen, halfWid, ...(driver ? { junction: driver.junction } : {}) }, age: 0 };
    if (driver) driver.junction.id = id;
    this.cars.push(car);
    return car;
  }

  remove(i: number): void {
    this.cars.splice(i, 1);
  }

  /** Un pas de simulation : conducteurs, physique, puis chocs. `player` : ce que la circulation voit du joueur. */
  step(dt: number, player: PlayerBody | null = null): void {
    const others = this.others;
    others.length = 0;
    for (const c of this.cars) others.push(c.other);
    let playerBody: { state: VehicleState; spec: VehicleSpec } | null = null;
    if (player?.kind === "vehicle") {
      const { halfLen, halfWid } = extentOf(player.spec);
      if (!this.playerOther || this.playerOther.state !== player.state) this.playerOther = { state: player.state, halfLen, halfWid };
      this.playerOther.halfLen = halfLen;
      this.playerOther.halfWid = halfWid;
      others.push(this.playerOther);
      playerBody = player;
    } else if (player?.kind === "foot") {
      FOOT.x = player.x;
      FOOT.y = player.y;
      FOOT.vx = player.vx;
      FOOT.vy = player.vy;
      others.push(this.footOther);
    }
    for (const c of this.cars) {
      c.state.impact = 0;
      const input = c.driver ? c.driver.update(c.state, dt, others) : PARKED;
      stepVehicle(c.state, c.spec, input, dt, this.terrain, this.colliders);
      c.age += dt;
    }
    this.stats.contacts = 0;
    this.stats.worstImpact = 0;
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const a = this.cars[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = this.cars[j]!;
        if (Math.abs(a.state.x - b.state.x) > 8 || Math.abs(a.state.y - b.state.y) > 8) continue;
        if (contactVehicles(a, b)) {
          this.stats.contacts++;
          this.stats.worstImpact = Math.max(this.stats.worstImpact, a.state.impact, b.state.impact);
        }
      }
      if (playerBody && Math.abs(a.state.x - playerBody.state.x) < 8 && Math.abs(a.state.y - playerBody.state.y) < 8 && contactVehicles(a, playerBody)) {
        this.stats.contacts++;
        this.stats.worstImpact = Math.max(this.stats.worstImpact, a.state.impact);
      }
    }
  }
}
