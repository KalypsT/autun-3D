import { Chaser, type ChaseTarget } from "./chase";
import type { Colliders } from "./collision";
import { Driver, extentOf, lanePoint, type Other } from "./driver";
import type { NavGraph } from "./nav-graph";
import { Signals } from "./signals";
import type { RoadMove } from "./road-graph";
import { createVehicle, stepVehicle, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";
import { contactVehicles } from "./vehicle-contact";
import { abandons, deratedSpec, VehicleDamage, type DamageProfile } from "./damage";
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
  /** Poursuite du joueur (police, J4) : null hors poursuite. */
  chase: Chaser | null;
  /** Impact (m/s) du dernier choc avec le véhicule du joueur à ce pas, 0 sans choc (J4 : percuter la police). */
  hitPlayer: number;
  /** Dégâts (D112) : les chocs (murs, autres voitures, joueur) l'abîment, son moteur faiblit ; trop abîmée, son conducteur s'arrête pour l'abandonner. */
  damage: VehicleDamage;
  /** Voiture de police. */
  police: boolean;
}

/** Ce que la circulation voit du joueur : le véhicule qu'il conduit (qui encaisse les chocs), ou lui-même à pied (obstacle, sans choc). */
export type PlayerBody = { kind: "vehicle"; state: VehicleState; spec: VehicleSpec } | { kind: "foot"; x: number; y: number; vx: number; vy: number };

/** Ce que la circulation sait des passants : la simulation des passants (`PedSim.forEachNear`) ou un faux dans les essais. */
export interface PedLookup {
  forEachNear(x: number, y: number, r: number, visit: (x: number, y: number, vx: number, vy: number, engaged: boolean) => void): void;
}

/** Les conducteurs regardent les passants à cette distance (m) de leur voiture. */
const PED_REACH = 30;

const FOOT: Other["state"] = { x: 0, y: 0, vx: 0, vy: 0, heading: 0 };
const PARKED: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
/** Un conducteur qui abandonne sa voiture abîmée freine jusqu'à l'arrêt. */
const STOPPING: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
const ORDINARY: DamageProfile = { toughness: 1, burns: true };

export class TrafficSim {
  readonly cars: SimCar[] = [];
  private serial = 0;
  private readonly others: Other[] = [];
  private playerOther: Other | null = null;
  private footOther: Other = { state: FOOT, halfLen: 0.4, halfWid: 0.4, player: true };
  /** Coups de klaxon de ce pas (le joueur bloque la route, choc) : les passants les entendent. */
  readonly honks: { x: number; y: number; vx: number; vy: number; heading: number; hull: VehicleSpec["hull"] }[] = [];
  private readonly hit = { impact: 0 };
  /** Contacts entre voitures et avec le joueur au dernier pas, et pire impact (m/s). */
  stats = { contacts: 0, worstImpact: 0 };
  /** Les passants (J3-3b) : les voitures les évitent, et s'arrêtent pour ceux qui traversent. Null : aucun. */
  peds: PedLookup | null = null;
  private readonly walkers: Other[] = [];
  private walkerCount = 0;
  private readonly scratch: Other[] = [];
  private readonly collect = (x: number, y: number, vx: number, vy: number, engaged: boolean): void => {
    let w = this.walkers[this.walkerCount];
    if (!w) w = this.walkers[this.walkerCount] = { state: { x: 0, y: 0, vx: 0, vy: 0, heading: 0 }, halfLen: 0.35, halfWid: 0.35, walker: true, engaged: false };
    w.state.x = x;
    w.state.y = y;
    w.state.vx = vx;
    w.state.vy = vy;
    w.state.heading = Math.atan2(vx, vy);
    w.engaged = engaged;
    this.walkerCount++;
  };

  /** Feux de circulation. Sans `signals`, la simulation a les siens, avec une horloge qu'elle fait avancer elle-même (essais) ; le jeu en passe un, partagé avec les passants. */
  readonly signals: Signals;
  private readonly ownClock: boolean;

  constructor(
    private readonly nav: NavGraph,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    signals?: Signals,
  ) {
    this.signals = signals ?? new Signals(nav.road, { t: 0 });
    this.ownClock = !signals;
  }

  /** Ajoute une voiture sur la voie de droite de `move`, à `s` m de son début, lancée à `speed` m/s ; sans graine, elle reste arrêtée. */
  add(spec: VehicleSpec, move: RoadMove, s: number, seed: number | null, speed = 0, profile: DamageProfile = ORDINARY, police = false): SimCar {
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(this.nav.road, move, s, lp);
    const state = createVehicle(lp.x, lp.y, lp.heading, this.terrain);
    state.vx = Math.sin(lp.heading) * speed;
    state.vy = Math.cos(lp.heading) * speed;
    state.speed = speed;
    const driver = seed === null ? null : new Driver(this.nav, move, s, seed, spec, this.colliders, this.signals);
    const { halfLen, halfWid } = extentOf(spec);
    const id = this.serial++;
    const car: SimCar = { id, spec, state, driver, other: { state, halfLen, halfWid, ...(driver ? { junction: driver.junction } : {}) }, age: 0, chase: null, hitPlayer: 0, damage: new VehicleDamage(profile), police };
    if (driver) driver.junction.id = id;
    this.cars.push(car);
    return car;
  }

  /** Une voiture est heurtée par le joueur : au-delà de 1,5 m/s, son conducteur est secoué (`Driver.bump`). Entre voitures, on continue (les frôlements viennent des rues étroites : s'arrêter au milieu d'un carrefour les multiplierait). */
  private shake(c: SimCar, impact: number): void {
    // Un gendarme en poursuite ne s'arrête pas pour un choc : il le cherchait peut-être.
    if (c.driver && !c.chase && impact > 1.5) c.driver.bump(impact);
  }

  /**
   * Le joueur klaxonne (J3-6) : les conducteurs dans le cône de 45° devant lui, à moins de 35 m, se pressent trois secondes.
   * `heading` : cap du joueur (rad, 0 = nord, sens horaire).
   */
  playerHorn(x: number, y: number, heading: number): void {
    const fx = Math.sin(heading), fy = Math.cos(heading);
    for (const c of this.cars) {
      const dx = c.state.x - x, dy = c.state.y - y, d = Math.hypot(dx, dy);
      if (!c.driver || d > 35 || d < 1 || (dx * fx + dy * fy) / d < Math.cos(0.8)) continue;
      c.driver.hurryUp();
    }
  }

  /** Lance (ou arrête) la poursuite du joueur par cette voiture (J4) ; son conducteur passe en conduite de poursuite, ou revient à la circulation. */
  setChase(c: SimCar, on: boolean): void {
    if (!c.driver || on === (c.chase !== null)) return;
    c.chase = on ? new Chaser(this.nav, this.colliders, c.spec) : null;
    if (!on) c.driver.setChase(false);
  }

  private readonly target: ChaseTarget = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Où vont les voitures en poursuite (J4) : null, sur le joueur ; sinon ce point (la fouille, quand la police l'a perdu de vue). */
  chaseTarget: ChaseTarget | null = null;

  /** Les voitures devant une voiture de poursuite lancée, à moins de 45 m et dans le même sens, se rangent à droite (une seconde, renouvelée tant qu'elle est là). */
  private sirens(): void {
    for (const p of this.cars) {
      if (!p.chase || p.state.speed < 3) continue;
      const fx = Math.sin(p.state.heading), fy = Math.cos(p.state.heading);
      for (const c of this.cars) {
        if (c === p || !c.driver || c.chase) continue;
        const dx = c.state.x - p.state.x, dy = c.state.y - p.state.y;
        if (Math.abs(dx) > 45 || Math.abs(dy) > 45) continue;
        const ahead = dx * fx + dy * fy;
        if (ahead < 0 || ahead > 45 || Math.abs(dx * fy - dy * fx) > 6) continue;
        if (Math.sin(c.state.heading) * fx + Math.cos(c.state.heading) * fy < 0.3) continue;
        c.driver.yieldTo(1);
      }
    }
  }

  remove(i: number): void {
    this.cars.splice(i, 1);
  }

  /** Un pas de simulation : conducteurs, physique, puis chocs. `player` : ce que la circulation voit du joueur. */
  step(dt: number, player: PlayerBody | null = null): void {
    if (this.ownClock) this.signals.clock.t += dt;
    const others = this.others;
    others.length = 0;
    for (const c of this.cars) others.push(c.other);
    let playerBody: { state: VehicleState; spec: VehicleSpec } | null = null;
    if (player?.kind === "vehicle") {
      const { halfLen, halfWid } = extentOf(player.spec);
      if (!this.playerOther || this.playerOther.state !== player.state) this.playerOther = { state: player.state, halfLen, halfWid, player: true };
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
    const t = this.target;
    let hasTarget = false;
    if (player?.kind === "vehicle") {
      t.x = player.state.x;
      t.y = player.state.y;
      t.vx = player.state.vx;
      t.vy = player.state.vy;
      hasTarget = true;
    } else if (player?.kind === "foot") {
      t.x = player.x;
      t.y = player.y;
      t.vx = player.vx;
      t.vy = player.vy;
      hasTarget = true;
    }
    if (this.chaseTarget) {
      Object.assign(t, this.chaseTarget);
      hasTarget = true;
    }
    this.sirens();
    // Une place autour de la cible par voiture en poursuite (dans l'ordre des voitures) : elles ne visent pas toutes le même point.
    let rank = 0;
    for (const c of this.cars) if (c.chase) c.chase.slot = rank++;
    for (const c of this.cars) {
      c.state.impact = 0;
      c.hitPlayer = 0;
      let seen: readonly Other[] = others;
      if (c.driver && this.peds) {
        this.walkerCount = 0;
        this.peds.forEachNear(c.state.x, c.state.y, PED_REACH, this.collect);
        if (this.walkerCount > 0) {
          const list = this.scratch;
          list.length = 0;
          for (const o of others) list.push(o);
          for (let k = 0; k < this.walkerCount; k++) list.push(this.walkers[k]!);
          seen = list;
        }
      }
      const input = !c.driver ? PARKED : abandons(c.damage) ? STOPPING : c.chase && hasTarget ? c.chase.update(c.state, c.driver, dt, seen, t) : c.driver.update(c.state, dt, seen);
      stepVehicle(c.state, deratedSpec(c.spec, c.damage.power), input, dt, this.terrain, this.colliders);
      c.age += dt;
    }
    this.stats.contacts = 0;
    this.stats.worstImpact = 0;
    this.honks.length = 0;
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const a = this.cars[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = this.cars[j]!;
        if (Math.abs(a.state.x - b.state.x) > 8 || Math.abs(a.state.y - b.state.y) > 8) continue;
        this.hit.impact = 0;
        if (contactVehicles(a, b, this.hit)) {
          this.stats.contacts++;
          this.stats.worstImpact = Math.max(this.stats.worstImpact, a.state.impact, b.state.impact);
          a.driver?.touch(b.id);
          b.driver?.touch(a.id);
        }
      }
      this.hit.impact = 0;
      if (playerBody && Math.abs(a.state.x - playerBody.state.x) < 8 && Math.abs(a.state.y - playerBody.state.y) < 8 && contactVehicles(a, playerBody, this.hit)) {
        this.stats.contacts++;
        this.stats.worstImpact = Math.max(this.stats.worstImpact, a.state.impact);
        a.hitPlayer = Math.max(a.hitPlayer, this.hit.impact);
        this.shake(a, this.hit.impact);
      }
    }
    // Dégâts (D112) : le pire choc du pas (mur, autre voiture, joueur) abîme chaque voiture, là où il a porté.
    for (const c of this.cars) {
      if (c.state.impact > 0) c.damage.hit(c.state.impact, c.state.impactAngle);
      c.damage.update(dt);
    }
    for (const c of this.cars) {
      if (!c.driver?.honking) continue;
      this.honks.push({ x: c.state.x, y: c.state.y, vx: c.state.vx, vy: c.state.vy, heading: c.state.heading, hull: c.spec.hull });
    }
  }
}
