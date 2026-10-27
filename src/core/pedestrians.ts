import { PED, ZONE } from "../data/nav";
import { crowdTarget } from "./crowd-density";
import type { HeightField } from "../data/types";
import { recipeFromSeed, type Recipe } from "./character";
import { phaseRate } from "./character-rig";
import type { Colliders, Resolution } from "./collision";
import { NavGraph, type Move } from "./nav-graph";
import { createCrowdState, type CrowdState } from "../render/crowd/crowd-types";

/**
 * Simulation des passants (J2) : des promeneurs qui suivent le graphe piéton, évitent les autres et le joueur, attendent aux passages quand un
 * véhicule arrive, naissent et disparaissent autour du joueur. Logique pure : le rendu lit `state` (D37) ; rien ici ne dessine.
 *
 * Analogie : un théâtre dont les figurants n'existent que dans la salle. Chacun a un rôle (une file à suivre, une humeur) ; ceux qu'on voit de près
 * jouent à fond (évitement, collisions) ; ceux du fond de la salle se contentent de marcher sur leur rail.
 * Repère : celui du jeu (x vers l'est, y vers le nord, cap en rad, 0 = nord, sens horaire). `state` est en repère three (z = −y).
 *
 * Structures prévues pour la suite (J3 à J5) : tout est en tableaux (ajouter un champ ne casse rien) ; `state` (marche, attente, traversée, arrêt),
 * `fear` (0 à 1), `flags` réservés ; les autres systèmes liront ou pousseront les passants par `bodies` / `events` en J2-6.
 */

export const PED_STATE = { walk: 0, wait: 1, cross: 2, idle: 3 } as const;

/** Distances (m) des paliers : près (évitement, collisions, tous les pas), milieu (un pas sur 3), loin (un pas sur 12). */
export const TIER_RANGE = [28, 80] as const;
const TIER_PERIOD = [1, 3, 12] as const;
const AVOID_RADIUS = 3;
const BODY = 0.28;

export interface PedSimOptions {
  /** Nombre d'emplacements (passants possibles à la fois). */
  capacity: number;
  /** Graine du monde : la scène est reproductible pour une graine et une suite de pas données. */
  seed: number;
  /** false : tous les passants jouent à fond à chaque pas (comparaison de coût). */
  tiers?: boolean;
  /** false : ni évitement ni collisions (comparaison de coût). */
  avoid?: boolean;
  /** Naissances au plus par pas. */
  spawnPerStep?: number;
  /** true : les passants peuvent naître dans le champ de vision (captures du viewer) ; défaut false (jeu). */
  spawnInView?: boolean;
}

/** Ce que la simulation sait du joueur à chaque pas : position, vitesse, direction du regard, et le véhicule qu'il conduit. */
export interface Observer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Direction du regard de la caméra (rad, 0 = nord, sens horaire). */
  yaw: number;
  /** Le joueur est à pied : les passants l'évitent comme un des leurs. */
  onFoot: boolean;
  /** Véhicule mobile du joueur (J2 : le seul danger aux passages) ; null sinon. */
  vehicle: { x: number; y: number; vx: number; vy: number } | null;
  /** Heure de jeu (0 à 24) : règle le nombre de passants (D39). Défaut : midi. */
  hour?: number;
}

export interface PedStats {
  spawns: number;
  despawns: number;
  /** Passants vivants et par palier au dernier pas. */
  alive: number;
  tiers: [number, number, number];
  /** Passants qui attendent à un passage, qui traversent, à l'arrêt. */
  waiting: number;
  crossing: number;
  idle: number;
  /** Naissances refusées faute d'endroit hors de vue. */
  spawnFailures: number;
  /** Nombre de passants visé à cette heure, dans ce quartier, à cette vitesse ; zone du graphe piéton autour du joueur. */
  target: number;
  zone: number;
}

const MASK_ZONE = (1 << PED.lane) | (1 << PED.path) | (1 << PED.pedestrianStreet) | (1 << PED.plaza) | (1 << PED.corner) | (1 << PED.crossing);
const MASK_WALK = (1 << PED.lane) | (1 << PED.path) | (1 << PED.pedestrianStreet) | (1 << PED.plaza) | (1 << PED.corner);

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number): number => ((((a - b) % TAU) + 3 * Math.PI) % TAU) - Math.PI;

function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function nextRandom(rng: Uint32Array, i: number): number {
  const a = (rng[i]! + 0x6d2b79f5) >>> 0;
  rng[i] = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Un véhicule arrive-t-il sur ce point (un passage) ? Vrai si, dans les 3,5 prochaines secondes, il passe à moins de 5 m de lui. Un véhicule à l'arrêt
 * (moins de 1 m/s) ne menace personne : on le contourne. J3 y ajoutera la circulation et les feux.
 */
export function vehicleThreat(x: number, y: number, veh: { x: number; y: number; vx: number; vy: number } | null): boolean {
  if (!veh) return false;
  const speed = Math.hypot(veh.vx, veh.vy);
  if (speed < 1) return false;
  const rx = x - veh.x, ry = y - veh.y;
  const ahead = (rx * veh.vx + ry * veh.vy) / speed;
  const miss = Math.abs(rx * veh.vy - ry * veh.vx) / speed;
  return ahead > -2 && ahead < 8 + speed * 3.5 && miss < 5;
}

export class PedSim {
  readonly state: CrowdState;
  readonly stats: PedStats = { spawns: 0, despawns: 0, alive: 0, tiers: [0, 0, 0], waiting: 0, crossing: 0, idle: 0, spawnFailures: 0, target: 0, zone: ZONE.outskirts };
  /** Appelé quand un emplacement reçoit un nouveau passant (le rendu l'habille). */
  onSpawn: ((slot: number, recipe: Recipe) => void) | null = null;

  private readonly n: number;
  // Un tableau par champ (accès rapide, rien à allouer).
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly heading: Float32Array;
  private readonly speed: Float32Array;
  private readonly want: Float32Array;
  private readonly edge: Int32Array;
  private readonly gen: Int32Array;
  private readonly dir: Int8Array;
  private readonly s: Float32Array;
  private readonly lat: Float32Array;
  private readonly latTarget: Float32Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly mode: Uint8Array;
  private readonly timer: Float32Array;
  private readonly fear: Float32Array;
  private readonly acc: Float32Array;
  private readonly rng: Uint32Array;
  private readonly id: Uint32Array;
  private readonly tier: Uint8Array;
  // Grille de voisinage : tête de liste par case (table de hachage) et chaînage.
  private readonly head = new Int32Array(4096).fill(-1);
  private readonly link: Int32Array;

  private frame = 0;
  private hour = 12;
  private excessCursor = 0;
  private spawned = 0;
  private spawnRng = 0;
  private readonly moves: Move[] = [];
  private readonly weights: number[] = [];
  private readonly res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };
  private readonly pt = { x: 0, y: 0 };
  private readonly tiers: boolean;
  private readonly avoid: boolean;
  private readonly spawnPerStep: number;

  constructor(
    private readonly graph: NavGraph,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders | null,
    private readonly opt: PedSimOptions,
  ) {
    const n = (this.n = opt.capacity);
    this.tiers = opt.tiers ?? true;
    this.avoid = opt.avoid ?? true;
    this.spawnPerStep = opt.spawnPerStep ?? 2;
    this.spawnRng = hash32(opt.seed, 0x51ed);
    this.state = createCrowdState(Array.from({ length: n }, () => recipeFromSeed(0)));
    this.state.alive = new Uint8Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.heading = new Float32Array(n);
    this.speed = new Float32Array(n); this.want = new Float32Array(n); this.edge = new Int32Array(n).fill(-1); this.gen = new Int32Array(n);
    this.dir = new Int8Array(n); this.s = new Float32Array(n); this.lat = new Float32Array(n); this.latTarget = new Float32Array(n);
    this.ox = new Float32Array(n); this.oy = new Float32Array(n); this.mode = new Uint8Array(n); this.timer = new Float32Array(n);
    this.fear = new Float32Array(n); this.acc = new Float32Array(n); this.rng = new Uint32Array(n); this.id = new Uint32Array(n);
    this.tier = new Uint8Array(n); this.link = new Int32Array(n).fill(-1);
  }

  get capacity(): number { return this.n; }

  /** Remplit tous les emplacements d'un coup (départ du jeu, du banc, des tests). */
  prefill(obs: Observer): void {
    this.hour = obs.hour ?? 12;
    const hit = this.graph.nearest(obs.x, obs.y, 80, MASK_ZONE);
    this.stats.zone = hit ? this.graph.edgeZone(hit.edge) : ZONE.outskirts;
    this.stats.target = crowdTarget(this.n, this.hour, this.stats.zone, Math.hypot(obs.vx, obs.vy));
    let alive = 0;
    for (let pass = 0; pass < 12 && alive < this.stats.target; pass++) {
      for (let i = 0; i < this.n && alive < this.stats.target; i++) {
        if (this.state.alive![i]) continue;
        // Au départ personne n'a encore regardé : la première image n'est pas vide, les passants naissent n'importe où dans la couronne.
        if (this.spawn(i, obs, 8, 35, 125, true)) alive++;
      }
    }
  }

  /** Fait avancer la simulation de `dt` secondes autour de l'observateur. */
  step(dt: number, obs: Observer): void {
    this.frame++;
    const st = this.state, alive = st.alive!, stats = this.stats;
    const v = Math.hypot(obs.vx, obs.vy);
    const rin = Math.min(35 + 3 * v, 110), rout = Math.min(rin + 90, 200);
    this.hour = obs.hour ?? 12;
    // Quartier du joueur (zone de la file la plus proche) : deux fois par seconde suffisent.
    if (this.frame % 30 === 1) {
      const hit = this.graph.nearest(obs.x, obs.y, 80, MASK_ZONE);
      stats.zone = hit ? this.graph.edgeZone(hit.edge) : ZONE.outskirts;
    }
    stats.target = crowdTarget(this.n, this.hour, stats.zone, v);
    if (this.avoid) this.buildGrid();
    const t0 = TIER_RANGE[0] * TIER_RANGE[0], t1 = TIER_RANGE[1] * TIER_RANGE[1];
    let near = 0, mid = 0, far = 0, waiting = 0, crossing = 0, idle = 0, nAlive = 0;
    for (let i = 0; i < this.n; i++) {
      if (!alive[i]) continue;
      const g = this.graph, e = this.edge[i]!;
      const dx = this.x[i]! - obs.x, dy = this.y[i]! - obs.y, d2 = dx * dx + dy * dy;
      // Hors de la couronne, ou sur une arête déchargée : le passant disparaît.
      if (d2 > (rout + 30) * (rout + 30) || g.generation(e) !== this.gen[i]) {
        alive[i] = 0;
        stats.despawns++;
        continue;
      }
      const tier = !this.tiers || d2 < t0 ? 0 : d2 < t1 ? 1 : 2;
      this.tier[i] = tier;
      if (tier === 0) near++; else if (tier === 1) mid++; else far++;
      nAlive++;
      this.acc[i]! += dt;
      const period = TIER_PERIOD[tier]!;
      if (period === 1 || (this.frame + this.id[i]!) % period === 0) {
        this.think(i, this.acc[i]!, tier, obs);
        this.acc[i] = 0;
      }
      // Avance le long de l'arête, à chaque image pour tous (une addition) ; les changements d'arête sont immédiats.
      const mode = this.mode[i]!;
      if (mode === PED_STATE.walk || mode === PED_STATE.cross) {
        this.s[i]! += this.dir[i]! * this.speed[i]! * (mode === PED_STATE.cross ? 1.25 : 1) * dt;
        const len = g.edgeLength(this.edge[i]!);
        if (this.s[i]! < 0 || this.s[i]! > len) this.arrive(i, len, obs);
      } else if (mode === PED_STATE.idle) {
        this.timer[i]! -= dt;
        if (this.timer[i]! <= 0) this.mode[i] = PED_STATE.walk;
      }
      this.place(i, tier, dt);
      const m2 = this.mode[i]!;
      if (m2 === PED_STATE.wait) waiting++; else if (m2 === PED_STATE.cross) crossing++; else if (m2 === PED_STATE.idle) idle++;
    }
    // Trop de monde pour l'heure ou le quartier : les passants à l'écart (hors de vue, ou à plus de 60 m) s'en vont, deux au plus par pas.
    if (nAlive > stats.target) {
      let leaving = 2;
      for (let k = 0; k < this.n && leaving > 0; k++) {
        const i = (this.excessCursor + k) % this.n;
        if (!alive[i]) continue;
        const dx = this.x[i]! - obs.x, dy = this.y[i]! - obs.y, d = Math.hypot(dx, dy);
        const hidden = d > 30 && Math.abs(angleDiff(Math.atan2(dx, dy), obs.yaw)) > 1.0;
        if (hidden || d > 60) {
          alive[i] = 0;
          stats.despawns++;
          nAlive--;
          this.excessCursor = i + 1;
          leaving--;
        }
      }
    }
    stats.alive = nAlive;
    stats.tiers = [near, mid, far];
    stats.waiting = waiting;
    stats.crossing = crossing;
    stats.idle = idle;
    // Naissances : les emplacements libres se remplissent, au plus `spawnPerStep` par pas.
    let attempts = nAlive < stats.target ? this.spawnPerStep : 0;
    for (let i = 0; i < this.n && attempts > 0; i++) {
      if (alive[i]) continue;
      attempts--;
      this.spawn(i, obs, 6, rin, rout);
    }
  }

  // --- Naissance --------------------------------------------------------------------------------------------------

  private random(): number {
    this.spawnRng = (this.spawnRng + 0x6d2b79f5) >>> 0;
    let t = this.spawnRng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Cherche un endroit de la couronne, hors du champ de vision, sur une file piétonne ; renvoie vrai si le passant est né. */
  private spawn(i: number, obs: Observer, tries: number, rin = 35, rout = 125, anywhere = false): boolean {
    for (let k = 0; k < tries; k++) {
      const a = this.random() * TAU, r = rin * 0.6 + this.random() * (rout - rin * 0.6);
      const px = obs.x + Math.sin(a) * r, py = obs.y + Math.cos(a) * r;
      const hit = this.graph.nearest(px, py, 25, MASK_WALK);
      if (!hit) continue;
      // Les files fréquentées attirent plus de monde.
      if (this.random() > 0.15 + 0.85 * (this.graph.edgeFoot(hit.edge) / 255)) continue;
      // Hors du champ de vision de la caméra (±55°), sauf au loin : sinon on le dit (spawnFailures) et on réessaie.
      const bearing = Math.atan2(hit.x - obs.x, hit.y - obs.y);
      const dist = Math.hypot(hit.x - obs.x, hit.y - obs.y);
      // Derrière la caméra (plus de 86° du regard) on peut naître plus près : le joueur ne le voit pas ; devant, au-delà de `rin`.
      const behind = Math.abs(angleDiff(bearing, obs.yaw)) > 1.5;
      if (dist < (anywhere ? 8 : behind ? rin * 0.6 : rin - 5) || dist > rout + 20) continue;
      if (!anywhere && !this.opt.spawnInView && dist < 140 && Math.abs(angleDiff(bearing, obs.yaw)) < 0.95) {
        this.stats.spawnFailures++;
        if (k < tries - 1) continue;
        if (dist < rin + 40) return false;
      }
      this.place0(i, hit.edge, hit.s, hit.x, hit.y);
      return true;
    }
    return false;
  }

  private place0(i: number, edge: number, s: number, x: number, y: number): void {
    this.spawned++;
    // Graine : monde, voie, heure de jeu et case de 6 m : la même personne se trouve au même endroit à la même heure (D39). Deux passants vivants
    // n'ont jamais la même graine (deux jumeaux côte à côte se verraient).
    const way = this.graph.edgeWay(edge) % 4294967296;
    let seed = hash32(hash32(this.opt.seed ^ way, Math.floor(this.hour)), hash32(Math.round(x / 6) + 4096, Math.round(y / 6) + 4096));
    for (let guard = 0; guard < 8 && this.taken(i, seed); guard++) seed = hash32(seed, guard + 1);
    this.rng[i] = seed ^ 0xa511e9b3;
    this.id[i] = seed;
    const recipe = recipeFromSeed(seed);
    this.state.recipes[i] = recipe;
    this.edge[i] = edge;
    this.gen[i] = this.graph.generation(edge);
    this.s[i] = s;
    this.dir[i] = nextRandom(this.rng, i) < 0.5 ? 1 : -1;
    const r = nextRandom(this.rng, i);
    // 6 % courent, les autres marchent entre 0,9 et 1,7 m/s (les seniors plus lentement).
    this.want[i] = r < 0.06 ? 3.4 + nextRandom(this.rng, i) * 1.4 : (recipe.age === "senior" ? 0.85 : 1.05) + nextRandom(this.rng, i) * 0.55;
    this.speed[i] = this.want[i]!;
    this.lat[i] = this.latTarget[i] = (nextRandom(this.rng, i) - 0.5) * 0.5;
    this.ox[i] = this.oy[i] = 0;
    this.mode[i] = PED_STATE.walk;
    this.timer[i] = 0;
    this.fear[i] = 0;
    this.acc[i] = 0;
    this.x[i] = x;
    this.y[i] = y;
    this.heading[i] = this.dir[i]! > 0 ? this.graph.pointAt(edge, s, this.pt) : this.graph.pointAt(edge, s, this.pt) + Math.PI;
    this.state.alive![i] = 1;
    this.state.phase[i] = nextRandom(this.rng, i) * TAU;
    this.stats.spawns++;
    this.onSpawn?.(i, recipe);
  }

  /** Un autre passant vivant a-t-il déjà cette graine ? */
  private taken(self: number, seed: number): boolean {
    for (let j = 0; j < this.n; j++) if (j !== self && this.state.alive![j] && this.id[j] === seed) return true;
    return false;
  }

  // --- Décisions --------------------------------------------------------------------------------------------------

  /** Décisions d'un passant (à son rythme selon le palier) : évitement, vitesse, côté de la file, attente aux passages. */
  private think(i: number, dt: number, tier: number, obs: Observer): void {
    const mode = this.mode[i]!;
    if (mode === PED_STATE.wait) {
      // Attente à l'entrée d'un passage : on traverse quand plus rien n'arrive.
      if (!this.threat(this.x[i]!, this.y[i]!, obs)) this.mode[i] = PED_STATE.cross;
      return;
    }
    let target = this.want[i]!;
    if (this.tiers && tier > 0) {
      this.speed[i] = target;
      return;
    }
    if (this.avoid && tier === 0 && mode !== PED_STATE.idle) target = this.avoidNeighbors(i, target, obs);
    const k = Math.min(1, dt * 3);
    this.speed[i]! += (target - this.speed[i]!) * k;
    this.lat[i]! += (this.latTarget[i]! - this.lat[i]!) * Math.min(1, dt * 2);
  }

  /** Vitesse retenue compte tenu des voisins devant, et côté de la file (on tient sa droite, on s'écarte d'un obstacle). */
  private avoidNeighbors(i: number, target: number, obs: Observer): number {
    const h = this.heading[i]!, fx = Math.sin(h), fy = Math.cos(h), rx = fy, ry = -fx;
    const px = this.x[i]!, py = this.y[i]!;
    let best = target, push = 0;
    const cx = Math.floor(px / 4), cy = Math.floor(py / 4);
    const visit = (jx: number, jy: number, jh: number, jv: number): void => {
      const rxp = jx - px, ryp = jy - py;
      const along = rxp * fx + ryp * fy, side = rxp * rx + ryp * ry;
      if (along < -0.2 || along > AVOID_RADIUS || Math.abs(side) > 1.1) return;
      const same = Math.cos(jh - h) > 0;
      // Devant, dans le même sens : on ralentit derrière ; en sens inverse : on se serre à droite ; dans l'axe : on s'écarte.
      if (same) best = Math.min(best, Math.max(0, (along - 0.7) * 0.9) + Math.min(jv, 0.6));
      push += side > 0 ? -1 : 1;
      if (along < 0.7 && Math.abs(side) < 0.6) best = Math.min(best, 0.3);
    };
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (let j = this.head[this.hash(ix, iy)]!; j >= 0; j = this.link[j]!) {
          if (j !== i) visit(this.x[j]!, this.y[j]!, this.heading[j]!, this.speed[j]!);
        }
      }
    }
    if (obs.onFoot) visit(obs.x, obs.y, Math.atan2(obs.vx, obs.vy), Math.hypot(obs.vx, obs.vy));
    // Côté de la file : milieu de la droite par défaut ; un obstacle pousse vers la droite (push > 0) ou la gauche.
    const half = Math.max(0.2, Math.min(1.2, this.graph.edgeWidth(this.edge[i]!) / 2) - 0.3);
    this.latTarget[i] = Math.max(-half, Math.min(half, 0.3 * half + push * 0.35));
    return best;
  }

  private threat(x: number, y: number, obs: Observer): boolean {
    return vehicleThreat(x, y, obs.vehicle);
  }

  /** Fin de l'arête : choisit la suite (tout droit de préférence, jamais demi-tour s'il y a mieux), attend si un passage est dangereux. */
  private arrive(i: number, len: number, obs: Observer): void {
    const g = this.graph;
    const e = this.edge[i]!, forward = this.dir[i]! > 0;
    const moves = this.moves;
    moves.length = 0;
    const n = g.next(e, forward ? 1 : 0, moves);
    const h = this.heading[i]!;
    let total = 0;
    const w = this.weights;
    w.length = 0;
    for (let k = 0; k < n; k++) {
      const m = moves[k]!, ne = Math.floor(m / 2), rev = m & 1;
      if (ne === e && rev === (forward ? 1 : 0)) {
        w.push(0.02);
        total += 0.02;
        continue;
      }
      const typ = g.edgeType(ne);
      const cap = g.pointAt(ne, rev ? g.edgeLength(ne) : 0, this.pt) + (rev ? Math.PI : 0);
      const dh = Math.abs(angleDiff(cap, h));
      let wt = (0.25 + g.edgeFoot(ne) / 255) * (dh < 0.5 ? 1 : dh < 1.3 ? 0.5 : 0.15);
      if (typ === PED.crossing || typ === PED.crossingSignal) wt *= 0.6;
      else if (typ === PED.crossingImplicit) wt *= 0.2;
      else if (typ === PED.path) wt *= 0.7;
      // On ne repart pas en sens inverse sur l'arête d'où l'on vient.
      w.push(wt);
      total += wt;
    }
    if (n === 0 || total <= 0) {
      // Impasse, bord du monde ou voisine pas encore chargée : demi-tour.
      this.dir[i] = -this.dir[i]!;
      this.s[i] = Math.min(Math.max(this.s[i]!, 0), len);
      return;
    }
    let r = nextRandom(this.rng, i) * total, pick = 0;
    for (let k = 0; k < n; k++) {
      r -= w[k]!;
      if (r < 0) {
        pick = k;
        break;
      }
    }
    const m = moves[pick]!, ne = Math.floor(m / 2), rev = m & 1;
    const over = forward ? this.s[i]! - len : -this.s[i]!;
    this.edge[i] = ne;
    this.gen[i] = g.generation(ne);
    this.dir[i] = rev ? -1 : 1;
    this.s[i] = rev ? g.edgeLength(ne) - over : over;
    this.s[i] = Math.min(Math.max(this.s[i]!, 0), g.edgeLength(ne));
    const typ = g.edgeType(ne);
    if (typ === PED.crossing || typ === PED.crossingSignal || typ === PED.crossingImplicit) {
      this.mode[i] = this.threat(this.x[i]!, this.y[i]!, obs) ? PED_STATE.wait : PED_STATE.cross;
    } else if (this.mode[i] === PED_STATE.cross) {
      this.mode[i] = PED_STATE.walk;
    }
    // Un arrêt de temps en temps (vitrine, banc, conversation) : un peu plus sur les places et dans les rues fréquentées.
    if (this.mode[i] === PED_STATE.walk && nextRandom(this.rng, i) < (typ === PED.plaza ? 0.1 : 0.03)) {
      this.mode[i] = PED_STATE.idle;
      this.timer[i] = 3 + nextRandom(this.rng, i) * 8;
      this.speed[i] = 0;
    }
  }

  // --- Position et sortie ----------------------------------------------------------------------------------------

  /** Position dans le monde : point de l'arête, décalage latéral, repoussement des obstacles (palier proche), hauteur ; écrit dans `state`. */
  private place(i: number, tier: number, dt: number): void {
    const g = this.graph, e = this.edge[i]!, dir = this.dir[i]!;
    const hd = g.pointAt(e, this.s[i]!, this.pt) + (dir > 0 ? 0 : Math.PI);
    this.heading[i] = hd;
    // Latéral : positif à droite du sens de marche.
    const lat = this.lat[i]!;
    let px = this.pt.x + Math.cos(hd) * lat, py = this.pt.y - Math.sin(hd) * lat;
    if (this.colliders && this.avoid && tier === 0) {
      const r = this.colliders.resolveInto(this.res, px, py, BODY);
      const tx = r.hit ? r.x - px : 0, ty = r.hit ? r.y - py : 0;
      const k = Math.min(1, dt * 12);
      this.ox[i]! += (tx - this.ox[i]!) * k;
      this.oy[i]! += (ty - this.oy[i]!) * k;
    } else {
      const decay = Math.max(0, 1 - dt * 4);
      this.ox[i]! *= decay;
      this.oy[i]! *= decay;
    }
    px += this.ox[i]!;
    py += this.oy[i]!;
    this.x[i] = px;
    this.y[i] = py;
    const st = this.state, v = this.mode[i] === PED_STATE.walk || this.mode[i] === PED_STATE.cross ? this.speed[i]! : 0;
    st.x[i] = px;
    st.z[i] = -py;
    st.y[i] = this.terrain.heightAt(px, py);
    st.yaw[i] = -hd;
    st.speed[i] = v;
    st.phase[i] = (st.phase[i]! + phaseRate(v, st.recipes[i]!.height) * dt) % TAU;
  }

  // --- Voisinage -------------------------------------------------------------------------------------------------

  private hash(ix: number, iy: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663)) & 4095;
  }

  private buildGrid(): void {
    this.head.fill(-1);
    const alive = this.state.alive!;
    for (let i = 0; i < this.n; i++) {
      if (!alive[i]) continue;
      const h = this.hash(Math.floor(this.x[i]! / 4), Math.floor(this.y[i]! / 4));
      this.link[i] = this.head[h]!;
      this.head[h] = i;
    }
  }

  /** Position d'un passant (repère du jeu), pour les tests et les autres systèmes. */
  position(i: number, out: { x: number; y: number }): void {
    out.x = this.x[i]!;
    out.y = this.y[i]!;
  }

  /** Empreinte de l'état (tests de reproductibilité) : somme pondérée des positions, caps et modes des passants vivants. */
  checksum(): number {
    let h = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.state.alive![i]) continue;
      h = (Math.imul(h, 31) + Math.round(this.x[i]! * 100) * 7 + Math.round(this.y[i]! * 100) * 13 + this.mode[i]! + (this.id[i]! & 0xffff)) | 0;
    }
    return h;
  }
}

