import type { HeightField } from "../data/types";
import type { Colliders, Resolution } from "./collision";
import type { NavGraph } from "./nav-graph";
import type { Observer } from "./pedestrians";

/**
 * Les pigeons (étape J2-7, D45) : de petites volées posées sur les places, les parvis et près des bancs, qui picorent, marchent, s'envolent
 * quand on approche (à pied, en véhicule, au klaxon, parmi les passants) et se reposent ailleurs. Le jour seulement.
 * Analogie : des gouttes de mercure sur une table : chaque oiseau va seul, mais la volée se pose, se lève et se déplace d'un bloc.
 *
 * Données en tableaux typés (un emplacement par oiseau) ; une volée (`Flock`) occupe un « coin à pigeons » (`Spot`) tiré des points d'intérêt de
 * la navigation (pigeon_spot, banc, lieu de culte). Aucun hasard hors de la graine : mêmes pas, même scène.
 */

const POI_BENCH = 0, POI_WORSHIP = 9, POI_PIGEON = 11;
const POI_MASK = (1 << POI_BENCH) | (1 << POI_WORSHIP) | (1 << POI_PIGEON);

export const PIGEON_MODE = { peck: 0, walk: 1, alert: 2, fly: 3 } as const;

/** Rayon d'action du jeu : on fait naître les volées entre ces distances du joueur, on les retire au-delà de `FAR`. */
const NEAR = 40, SPAWN_FAR = 130, FAR = 190;
const SPOT_RADIUS = 260;
const MAX_FLOCKS = 24;
const DIRECTOR_PERIOD = 0.4;
/** Heures de présence des pigeons. */
const DAY_FROM = 7, DAY_TO = 20.5;
const BIRD_RADIUS = 0.12;

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number): number => ((((a - b) % TAU) + 3 * Math.PI) % TAU) - Math.PI;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Nombre de pigeons autorisés selon l'heure : rien la nuit, une montée le matin, une descente le soir. */
export function pigeonRamp(hour: number): number {
  if (hour <= DAY_FROM || hour >= DAY_TO) return 0;
  return clamp(Math.min((hour - DAY_FROM) / 2.5, (DAY_TO - hour) / 2), 0, 1);
}

/** Nombre maximal de pigeons pour un réglage de foule (D45) : 40 % du nombre de passants, 40 au plus ; 0 sans foule. */
export function pigeonCapacity(crowd: number): number {
  return crowd <= 0 ? 0 : Math.min(40, Math.round(crowd * 0.4));
}

/** Un coin à pigeons : un point d'intérêt de la navigation (dédoublonné à 6 m). */
interface Spot {
  x: number;
  y: number;
  /** Rayon d'étalement de la volée (m) et effectif minimal et maximal. */
  rad: number;
  min: number;
  max: number;
  /** Attrait 0 à 1 (quartier, hasard stable). */
  pop: number;
  flock: Flock | null;
  /** Secondes avant qu'une nouvelle volée puisse venir (après un envol). */
  cool: number;
  /** Dernier passage du recensement. */
  seen: number;
}

interface Flock {
  spot: Spot | null;
  members: number[];
  /** Oiseaux de la volée qui s'apprêtent à partir ou volent : pas de nouvelle alerte tant que > 0. */
  busy: number;
}

export interface PigeonState {
  capacity: number;
  alive: Uint8Array;
  /** Position (repère du jeu : x est, y nord) et altitude absolue (m). */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Cap (rad, 0 = nord, sens horaire) et assiette du corps (rad, positif : bec vers le haut). */
  heading: Float32Array;
  pitch: Float32Array;
  /** Battement : angle de l'aile (rad, positif : vers le haut), pli supplémentaire de l'aile externe, déploiement (0 : repliée, 1 : ouverte). */
  wing: Float32Array;
  wing2: Float32Array;
  fold: Float32Array;
  /** Coup de bec (0 à 1), avance de la tête en marchant (m), variante de plumage (0 à 3). */
  peck: Float32Array;
  bob: Float32Array;
  tint: Uint8Array;
}

export interface PigeonStats {
  alive: number;
  grounded: number;
  flying: number;
  flocks: number;
  spots: number;
  /** Envols de volées (cumul). */
  scatters: number;
}

export interface PigeonOptions {
  capacity: number;
  seed: number;
  /** true : les volées peuvent naître près du joueur et en vue (captures du viewer) ; défaut false. */
  spawnInView?: boolean;
}

/** Ce que la simulation demande aux passants : qui est dans un cercle (une volée s'envole si l'un d'eux la frôle). */
export interface PigeonPeds {
  queryCircle(x: number, y: number, r: number, out: number[]): number;
}

export class PigeonSim {
  readonly capacity: number;
  readonly state: PigeonState;
  readonly stats: PigeonStats = { alive: 0, grounded: 0, flying: 0, flocks: 0, spots: 0, scatters: 0 };
  /** Appelée à chaque envol de volée (pour un futur son, J7) : position du coin. */
  onScatter: ((x: number, y: number) => void) | null = null;

  private readonly mode: Uint8Array;
  private readonly timer: Float32Array;
  private readonly phase: Float32Array;
  private readonly flockOf: Int16Array;
  /** Cible de marche, départ et arrivée du vol, durée et hauteur du vol, progression 0 à 1. */
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly fx0: Float32Array;
  private readonly fy0: Float32Array;
  private readonly fz0: Float32Array;
  private readonly fx1: Float32Array;
  private readonly fy1: Float32Array;
  private readonly fz1: Float32Array;
  private readonly fdur: Float32Array;
  private readonly fh: Float32Array;
  private readonly ft: Float32Array;
  private readonly delay: Float32Array;
  /** Vol sans atterrissage : l'oiseau monte et disparaît au loin (nuit, plus de coin libre). */
  private readonly gone: Uint8Array;
  private readonly free: number[] = [];
  private readonly flocks: (Flock | null)[] = new Array(MAX_FLOCKS).fill(null);
  private readonly spots: Spot[] = [];
  private spotVersion = -1;
  /** Heure (s de simulation) du dernier recensement : pas plus d'un toutes les 1,5 s, même quand le graphe change sans cesse en roulant. */
  private spotClock = -1e9;
  private spotX = 1e9;
  private spotY = 1e9;
  private rng: number;
  private clock = 0;
  private clockStamp = 0;
  private directorT = 0;
  private pedTick = 0;
  private readonly res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };
  private readonly scratch: number[] = [];
  private readonly spawnInView: boolean;
  private count = 0;

  constructor(
    private readonly graph: NavGraph,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    opt: PigeonOptions,
  ) {
    const n = (this.capacity = Math.max(0, opt.capacity));
    this.spawnInView = opt.spawnInView ?? false;
    this.rng = hash32(opt.seed, 0x91e0) || 1;
    const f = (): Float32Array => new Float32Array(n);
    this.state = {
      capacity: n, alive: new Uint8Array(n), x: f(), y: f(), z: f(), heading: f(), pitch: f(), wing: f(), wing2: f(), fold: f(), peck: f(), bob: f(), tint: new Uint8Array(n),
    };
    this.mode = new Uint8Array(n);
    this.timer = f();
    this.phase = f();
    this.flockOf = new Int16Array(n).fill(-1);
    this.tx = f(); this.ty = f();
    this.fx0 = f(); this.fy0 = f(); this.fz0 = f();
    this.fx1 = f(); this.fy1 = f(); this.fz1 = f();
    this.fdur = f(); this.fh = f(); this.ft = f(); this.delay = f();
    this.gone = new Uint8Array(n);
    for (let i = n - 1; i >= 0; i--) this.free.push(i);
  }

  private random(): number {
    let t = (this.rng = (this.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Remplit la scène d'emblée (début de partie) : un recensement des coins puis un tour de directeur sans minimum de distance forcé. */
  prefill(obs: Observer): void {
    this.refreshSpots(obs, true);
    this.director(obs, true);
  }

  // --- Coins à pigeons -----------------------------------------------------------------------------------------------

  private refreshSpots(obs: Observer, force = false): void {
    const moved = Math.hypot(obs.x - this.spotX, obs.y - this.spotY);
    if (!force && (this.clock - this.spotClock < 1.5 || (this.graph.version === this.spotVersion && moved < 60))) return;
    this.spotClock = this.clock;
    this.spotVersion = this.graph.version;
    this.spotX = obs.x;
    this.spotY = obs.y;
    const stamp = ++this.clockStamp;
    this.graph.forEachPoi(POI_MASK, obs.x, obs.y, SPOT_RADIUS, (kind, px, py) => {
      let found: Spot | null = null;
      for (const s of this.spots) {
        if (Math.abs(s.x - px) < 6 && Math.abs(s.y - py) < 6 && Math.hypot(s.x - px, s.y - py) < 6) { found = s; break; }
      }
      if (found) {
        found.seen = stamp;
        return;
      }
      const near = this.graph.nearest(px, py, 14);
      if (!near) return;
      const zone = this.graph.edgeZone(near.edge);
      const weight = zone === 0 ? 1 : zone === 1 ? 0.65 : zone === 2 ? 0.25 : 0.5;
      const h = hash32(Math.round(px * 4), Math.round(py * 4)) / 4294967296;
      const spec = kind === POI_PIGEON ? { rad: 2.4, min: 3, max: 7 } : kind === POI_WORSHIP ? { rad: 3, min: 4, max: 6 } : { rad: 1.4, min: 2, max: 3 };
      this.spots.push({ x: px, y: py, ...spec, pop: weight * (0.55 + 0.45 * h), flock: null, cool: 0, seen: stamp });
    });
    // Oublie les coins sortis du rayon et inoccupés.
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i]!;
      if (s.seen !== stamp && !s.flock && Math.hypot(s.x - obs.x, s.y - obs.y) > SPOT_RADIUS + 20) this.spots.splice(i, 1);
    }
    this.stats.spots = this.spots.length;
  }

  // --- Directeur : naissances, retraits, nuit ------------------------------------------------------------------------

  private director(obs: Observer, prefill = false): void {
    const hour = obs.hour ?? 12;
    const ramp = pigeonRamp(hour);
    const cap = Math.round(this.capacity * ramp);
    // Retraits : trop loin, ou nuit.
    for (let f = 0; f < MAX_FLOCKS; f++) {
      const fl = this.flocks[f];
      if (!fl || fl.busy > 0 || !fl.spot) continue;
      const d = Math.hypot(fl.spot.x - obs.x, fl.spot.y - obs.y);
      if (d > FAR) this.removeFlock(f);
      else if (ramp <= 0) {
        if (d > 70) this.removeFlock(f);
        else this.flush(f, obs.x, obs.y, true);
      }
    }
    if (cap <= 0) return;
    let birds = this.count;
    const minD = prefill ? 25 : this.spawnInView ? 3 : NEAR;
    for (const s of this.spots) {
      if (birds >= cap) break;
      if (s.flock || s.cool > 0) continue;
      const dx = s.x - obs.x, dy = s.y - obs.y, d = Math.hypot(dx, dy);
      if (d < minD || d > SPAWN_FAR) continue;
      // Hors de vue ? au loin, ou derrière le joueur.
      if (!prefill && !this.spawnInView && d < 70 && dx * Math.sin(obs.yaw) + dy * Math.cos(obs.yaw) > -0.2 * d) continue;
      if (this.random() > s.pop * (prefill ? 0.9 : 0.35)) continue;
      const n = s.min + Math.floor(this.random() * (s.max - s.min + 1));
      if (birds + n > cap) continue;
      const f = this.flocks.indexOf(null);
      if (f < 0) break;
      birds += this.spawnFlock(f, s, n);
    }
  }

  private spawnFlock(f: number, s: Spot, n: number): number {
    const fl: Flock = { spot: s, members: [], busy: 0 };
    this.flocks[f] = fl;
    s.flock = fl;
    for (let k = 0; k < n; k++) {
      const i = this.free.pop();
      if (i === undefined) break;
      const a = this.random() * TAU, r = Math.sqrt(this.random()) * s.rad;
      this.place(i, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      this.mode[i] = PIGEON_MODE.peck;
      this.timer[i] = this.random() * 3;
      this.phase[i] = this.random() * TAU;
      this.flockOf[i] = f;
      this.state.heading[i] = this.random() * TAU;
      this.state.tint[i] = this.random() < 0.62 ? 0 : this.random() < 0.55 ? 1 : this.random() < 0.6 ? 2 : 3;
      this.state.alive[i] = 1;
      this.state.fold[i] = 0;
      this.state.wing[i] = 0;
      this.state.pitch[i] = 0;
      this.gone[i] = 0;
      fl.members.push(i);
      this.count++;
    }
    return fl.members.length;
  }

  /** Pose un oiseau au sol en (x, y), repoussé hors des murs. */
  private place(i: number, x: number, y: number): void {
    const r = this.colliders.resolveInto(this.res, x, y, BIRD_RADIUS);
    this.state.x[i] = r.x;
    this.state.y[i] = r.y;
    this.state.z[i] = this.terrain.heightAt(r.x, r.y);
  }

  private kill(i: number): void {
    const f = this.flockOf[i]!;
    const fl = f >= 0 ? this.flocks[f] : null;
    if (fl) {
      const k = fl.members.indexOf(i);
      if (k >= 0) fl.members.splice(k, 1);
      if (this.mode[i] === PIGEON_MODE.alert || this.mode[i] === PIGEON_MODE.fly) fl.busy = Math.max(0, fl.busy - 1);
      if (fl.members.length === 0) {
        if (fl.spot && fl.spot.flock === fl) fl.spot.flock = null;
        this.flocks[f] = null;
      }
    }
    this.state.alive[i] = 0;
    this.flockOf[i] = -1;
    this.free.push(i);
    this.count--;
  }

  private removeFlock(f: number): void {
    const fl = this.flocks[f];
    if (!fl) return;
    for (const i of [...fl.members]) this.kill(i);
  }

  // --- Envol ---------------------------------------------------------------------------------------------------------

  /**
   * Fait partir la volée `f` loin de (tx, ty) : vers un autre coin libre à vue (20 à 70 m), sinon (ou si `leave`) vers le large où les
   * oiseaux disparaissent.
   */
  private flush(f: number, tx: number, ty: number, leave = false): void {
    const fl = this.flocks[f];
    if (!fl || !fl.spot || fl.busy > 0) return;
    const src = fl.spot;
    let dest: Spot | null = null;
    if (!leave) {
      let pick = -1, tries = 0;
      const cands: number[] = [];
      for (let k = 0; k < this.spots.length; k++) {
        const s = this.spots[k]!;
        if (s === src || s.flock || s.cool > 0) continue;
        const d = Math.hypot(s.x - src.x, s.y - src.y);
        if (d < 18 || d > 70 || Math.hypot(s.x - tx, s.y - ty) < 10) continue;
        cands.push(k);
      }
      while (cands.length > 0 && tries++ < 6 && pick < 0) {
        const c = Math.floor(this.random() * cands.length);
        const s = this.spots[cands[c]!]!;
        if (this.colliders.raycast(src.x, src.y, s.x, s.y) === null) pick = cands[c]!;
        cands.splice(c, 1);
      }
      if (pick >= 0) dest = this.spots[pick]!;
    }
    src.flock = null;
    src.cool = 8 + this.random() * 8;
    this.stats.scatters++;
    this.onScatter?.(src.x, src.y);
    fl.spot = dest;
    if (dest) {
      dest.flock = fl;
      dest.cool = 0;
    }
    // Direction de fuite : loin de la menace.
    let ax = src.x - tx, ay = src.y - ty;
    const al = Math.hypot(ax, ay);
    if (al < 1e-3) { ax = Math.sin(this.random() * TAU); ay = Math.cos(this.random() * TAU); } else { ax /= al; ay /= al; }
    for (const i of fl.members) {
      this.mode[i] = PIGEON_MODE.alert;
      this.delay[i] = this.random() * 0.45;
      this.gone[i] = dest ? 0 : 1;
      this.state.heading[i] = Math.atan2(ax, ay);
      this.state.peck[i] = 0;
      if (dest) {
        const a = this.random() * TAU, r = Math.sqrt(this.random()) * dest.rad;
        this.tx[i] = dest.x + Math.cos(a) * r;
        this.ty[i] = dest.y + Math.sin(a) * r;
      } else {
        const spread = (this.random() - 0.5) * 0.9;
        this.tx[i] = this.state.x[i]! + (ax * Math.cos(spread) - ay * Math.sin(spread)) * 120;
        this.ty[i] = this.state.y[i]! + (ax * Math.sin(spread) + ay * Math.cos(spread)) * 120;
      }
    }
    fl.busy = fl.members.length;
  }

  /** Fait s'envoler les volées posées à moins de `r` de (x, y) (klaxon, bruit, et plus tard les tirs de J5). */
  scatter(x: number, y: number, r: number): void {
    for (let f = 0; f < MAX_FLOCKS; f++) {
      const fl = this.flocks[f];
      if (fl?.spot && fl.busy === 0 && Math.hypot(fl.spot.x - x, fl.spot.y - y) <= r) this.flush(f, x, y);
    }
  }

  private launch(i: number): void {
    const st = this.state;
    this.fx0[i] = st.x[i]!;
    this.fy0[i] = st.y[i]!;
    this.fz0[i] = st.z[i]!;
    this.fx1[i] = this.tx[i]!;
    this.fy1[i] = this.ty[i]!;
    const gone = this.gone[i] === 1;
    this.fz1[i] = gone ? st.z[i]! : this.terrain.heightAt(this.tx[i]!, this.ty[i]!);
    const dist = Math.hypot(this.tx[i]! - st.x[i]!, this.ty[i]! - st.y[i]!);
    const v = 6 + this.random() * 2;
    this.fdur[i] = Math.max(1.3, dist / v);
    this.fh[i] = gone ? 18 + this.random() * 6 : clamp(2.6 + dist * 0.06 + this.random() * 1.5, 3, 6);
    this.ft[i] = 0;
    this.mode[i] = PIGEON_MODE.fly;
    this.timer[i] = 0;
    st.heading[i] = Math.atan2(this.tx[i]! - st.x[i]!, this.ty[i]! - st.y[i]!);
  }

  private altitude(i: number, t: number): number {
    if (this.gone[i]) {
      const u = Math.min(1, t * 2.5);
      return this.fh[i]! * (1 - (1 - u) * (1 - u));
    }
    return this.fh[i]! * Math.sin(Math.PI * Math.pow(Math.min(1, t), 0.6));
  }

  // --- Pas de simulation ---------------------------------------------------------------------------------------------

  step(dt: number, obs: Observer, peds: PigeonPeds | null = null): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.refreshSpots(obs);
    for (const s of this.spots) if (s.cool > 0) s.cool -= dt;
    this.directorT += dt;
    if (this.directorT >= DIRECTOR_PERIOD) {
      this.directorT = 0;
      this.director(obs);
    }
    if (obs.horn) this.scatter(obs.x, obs.y, 35);

    // Menaces : le joueur à pied ou son véhicule en marche, et les passants qui frôlent.
    const veh = obs.vehicle;
    const speed = veh ? Math.hypot(veh.vx, veh.vy) : Math.hypot(obs.vx, obs.vy);
    const px = veh ? veh.x : obs.x, py = veh ? veh.y : obs.y;
    const reach = veh ? (speed > 1.5 ? clamp(7 + speed, 8, 18) : 3.5) : 3.5 + 0.35 * speed;
    this.pedTick -= dt;
    const checkPeds = peds !== null && this.pedTick <= 0;
    if (checkPeds) this.pedTick = 0.25;

    const st = this.state;
    for (let i = 0; i < this.capacity; i++) {
      if (!st.alive[i]) continue;
      const m = this.mode[i]!;
      if (m === PIGEON_MODE.peck || m === PIGEON_MODE.walk) {
        const f = this.flockOf[i]!;
        const fl = this.flocks[f];
        if (fl && fl.busy === 0) {
          if (Math.hypot(st.x[i]! - px, st.y[i]! - py) < reach) this.flush(f, px, py);
          else if (checkPeds && this.pedNear(peds!, st.x[i]!, st.y[i]!)) this.flush(f, st.x[i]! + 0.01, st.y[i]!);
        }
      }
      switch (this.mode[i]) {
        case PIGEON_MODE.peck: this.doPeck(i, dt); break;
        case PIGEON_MODE.walk: this.doWalk(i, dt); break;
        case PIGEON_MODE.alert: this.doAlert(i, dt); break;
        default: this.doFly(i, dt, obs); break;
      }
    }
    // Statistiques.
    let grounded = 0, flying = 0, flocks = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!st.alive[i]) continue;
      if (this.mode[i] === PIGEON_MODE.fly) flying++; else grounded++;
    }
    for (const fl of this.flocks) if (fl) flocks++;
    this.stats.alive = grounded + flying;
    this.stats.grounded = grounded;
    this.stats.flying = flying;
    this.stats.flocks = flocks;
  }

  /** Un passant à moins de 1,6 m, qui bouge, et un coup de dé (0,2 par vérification) : la volée part. */
  private pedNear(peds: PigeonPeds, x: number, y: number): boolean {
    this.scratch.length = 0;
    if (peds.queryCircle(x, y, 1.6, this.scratch) === 0) return false;
    return this.random() < 0.2;
  }

  private turn(i: number, target: number, rate: number, dt: number): void {
    const h = this.state.heading[i]!;
    this.state.heading[i] = h + angleDiff(target, h) * Math.min(1, rate * dt);
  }

  private doPeck(i: number, dt: number): void {
    const st = this.state;
    this.timer[i] = this.timer[i]! - dt;
    this.phase[i] = this.phase[i]! + dt;
    // Bec dans la terre par salves : un sinus rectifié élevé à la 3e puissance donne de brefs coups.
    const burst = Math.sin(this.phase[i]! * 0.9) > -0.2 ? 1 : 0;
    st.peck[i] = burst * Math.pow(Math.abs(Math.sin(this.phase[i]! * 7.5)), 2);
    st.bob[i] = 0;
    st.fold[i] = 0;
    st.wing[i] = 0;
    st.pitch[i] = 0;
    if (this.timer[i]! <= 0) this.nextWalk(i);
  }

  private nextWalk(i: number): void {
    const fl = this.flocks[this.flockOf[i]!];
    const home = fl?.spot;
    if (!home || this.random() < 0.3) {
      this.timer[i] = 1 + this.random() * 3;
      return;
    }
    const a = this.random() * TAU, r = Math.sqrt(this.random()) * home.rad;
    this.tx[i] = home.x + Math.cos(a) * r;
    this.ty[i] = home.y + Math.sin(a) * r;
    this.mode[i] = PIGEON_MODE.walk;
    this.timer[i] = 6;
  }

  private doWalk(i: number, dt: number): void {
    const st = this.state;
    const dx = this.tx[i]! - st.x[i]!, dy = this.ty[i]! - st.y[i]!, d = Math.hypot(dx, dy);
    this.timer[i] = this.timer[i]! - dt;
    this.phase[i] = this.phase[i]! + dt * 7;
    st.peck[i] = 0;
    st.fold[i] = 0;
    st.wing[i] = 0;
    st.pitch[i] = 0;
    if (d < 0.08 || this.timer[i]! <= 0) {
      this.mode[i] = PIGEON_MODE.peck;
      this.timer[i] = 1 + this.random() * 3;
      st.bob[i] = 0;
      return;
    }
    this.turn(i, Math.atan2(dx, dy), 10, dt);
    const v = Math.min(d / dt, 0.55);
    const nx = st.x[i]! + (dx / d) * v * dt, ny = st.y[i]! + (dy / d) * v * dt;
    const r = this.colliders.resolveInto(this.res, nx, ny, BIRD_RADIUS);
    st.x[i] = r.x;
    st.y[i] = r.y;
    st.z[i] = this.terrain.heightAt(r.x, r.y);
    st.bob[i] = Math.sin(this.phase[i]!) * 0.014;
  }

  private doAlert(i: number, dt: number): void {
    const st = this.state;
    this.delay[i] = this.delay[i]! - dt;
    st.peck[i] = 0;
    st.bob[i] = 0;
    st.fold[i] = 0.35;
    st.wing[i] = Math.sin(this.clock * 40 + i) * 0.35;
    if (this.delay[i]! <= 0) this.launch(i);
  }

  private doFly(i: number, dt: number, obs: Observer): void {
    const st = this.state;
    const t = this.ft[i]! + dt / this.fdur[i]!;
    this.ft[i] = t;
    this.phase[i] = this.phase[i]! + dt * (t < 0.3 ? 9 : 7) * TAU;
    const tt = Math.min(t, 1);
    const x = this.fx0[i]! + (this.fx1[i]! - this.fx0[i]!) * tt;
    const y = this.fy0[i]! + (this.fy1[i]! - this.fy0[i]!) * tt;
    const base = this.fz0[i]! + (this.fz1[i]! - this.fz0[i]!) * tt;
    st.x[i] = x;
    st.y[i] = y;
    st.z[i] = base + this.altitude(i, tt);
    // Assiette : pente de la trajectoire (différence finie), cabrage à l'arrivée.
    const e = 0.02;
    const slope = (this.altitude(i, Math.min(1, tt + e)) - this.altitude(i, Math.max(0, tt - e))) / (Math.min(1, tt + e) - Math.max(0, tt - e)) / this.fdur[i]!;
    const hv = Math.hypot(this.fx1[i]! - this.fx0[i]!, this.fy1[i]! - this.fy0[i]!) / this.fdur[i]!;
    const flare = this.gone[i] ? 0 : Math.max(0, (tt - 0.9) / 0.1);
    st.pitch[i] = clamp(Math.atan2(slope, Math.max(hv, 1)), -0.55, 0.9) + flare * 0.5;
    // Ailes : battements amples à la montée, planés à la descente, freinage à l'arrivée.
    const amp = tt < 0.35 ? 0.95 : tt < 0.75 ? 0.6 : 0.2 + flare * 0.7;
    st.wing[i] = Math.sin(this.phase[i]!) * amp + 0.15;
    st.wing2[i] = Math.cos(this.phase[i]!) * amp * 0.55;
    st.fold[i] = this.gone[i] ? Math.min(1, tt * 12) : Math.min(1, tt * 14) * Math.min(1, (1 - tt) * 14);
    st.peck[i] = 0;
    st.bob[i] = 0;
    if (this.gone[i]) {
      if (t >= 1 || Math.hypot(x - obs.x, y - obs.y) > 100) this.kill(i);
    } else if (t >= 1) this.land(i);
  }

  private land(i: number): void {
    const st = this.state;
    const r = this.colliders.resolveInto(this.res, this.fx1[i]!, this.fy1[i]!, BIRD_RADIUS);
    st.x[i] = r.x;
    st.y[i] = r.y;
    st.z[i] = this.terrain.heightAt(r.x, r.y);
    st.pitch[i] = 0;
    st.fold[i] = 0;
    st.wing[i] = 0;
    st.wing2[i] = 0;
    this.mode[i] = PIGEON_MODE.peck;
    this.timer[i] = 0.4 + this.random() * 2;
    const fl = this.flocks[this.flockOf[i]!];
    if (fl) fl.busy = Math.max(0, fl.busy - 1);
  }

  /** Empreinte de l'état (tests de reproductibilité). */
  checksum(): number {
    let h = 0;
    const st = this.state;
    for (let i = 0; i < this.capacity; i++) {
      if (!st.alive[i]) continue;
      h = (Math.imul(h, 31) + Math.round(st.x[i]! * 100) * 7 + Math.round(st.y[i]! * 100) * 13 + Math.round(st.z[i]! * 100) * 3 + this.mode[i]!) | 0;
    }
    return h;
  }

  /** Mode d'un oiseau (tests). */
  modeOf(i: number): number {
    return this.mode[i]!;
  }

  /** Coins connus (tests et captures) : positions et occupation. */
  spotList(): { x: number; y: number; busy: boolean }[] {
    return this.spots.map((s) => ({ x: s.x, y: s.y, busy: s.flock !== null }));
  }
}
