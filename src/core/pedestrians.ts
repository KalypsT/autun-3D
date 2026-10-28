import { PED, ZONE } from "../data/nav";
import { crowdTarget } from "./crowd-density";
import type { HeightField } from "../data/types";
import { recipeFromSeed, type Recipe } from "./character";
import { coldAt, dressForCold } from "./dress";
import { DOWN_TIME, HIT_POSE, phaseRate, STUMBLE_TIME } from "./character-rig";
import type { Colliders, Resolution } from "./collision";
import { NavGraph, type Move } from "./nav-graph";
import type { Signals } from "./signals";
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

export const PED_STATE = { walk: 0, wait: 1, cross: 2, idle: 3, stumble: 4, down: 5, dead: 6 } as const;

/** Distances (m) des paliers : près (évitement, collisions, tous les pas), milieu (un pas sur 3), loin (un pas sur 12). */
export const TIER_RANGE = [28, 80] as const;
const TIER_PERIOD = [1, 3, 12] as const;
const AVOID_RADIUS = 3;
const BODY = 0.28;
/** Rayon du joueur à pied (le même que `PLAYER_RADIUS` de `player.ts`). */
const PLAYER_BODY = 0.35;
/** Coque d'un véhicule inconnu : un cercle de 0,8 m. */
/** Vitesse de fuite (m/s) d'un passant paniqué. */
export const FLEE_SPEED = 3.8;
/** Durée de la fuite (s) du conducteur dont on prend la voiture. */
export const FLEE_TIME = 14;
/** Points de vie d'un passant (J5, D80). */
export const PED_HP = 100;
/** Sous ce niveau le passant est blessé : il s'enfuit plus lentement (il boite). */
export const WOUNDED_HP = 40;
/** Fuite (s) d'un passant touché ; blessé, il fuit plus longtemps. */
export const HURT_FLEE = 8;
export const WOUNDED_FLEE = 20;
/** Cadavres (J5-2, D80) : au plus `MAX_CORPSES` ; au-delà, le plus ancien s'enfonce dans le sol. Hors de vue ils s'enfoncent après `CORPSE_HIDDEN_LIFE` s, vus après `CORPSE_MAX_LIFE` s. */
export const MAX_CORPSES = 8;
export const CORPSE_HIDDEN_LIFE = 60;
export const CORPSE_MAX_LIFE = 150;
/** Durée (s) de l'enfoncement, et profondeur atteinte (m) : le corps gît à 24 cm du sol, il disparaît sous le terrain. */
export const SINK_TIME = 3;
const SINK_DEPTH = 0.6;
/** Un cadavre de moins de … s est un obstacle pour les voitures (elles s'arrêtent) ; plus ancien, elles passent (pas d'embouteillage permanent). */
const CORPSE_BLOCKS = 20;
/** Dégâts d'un véhicule au-delà de 3,5 m/s : `(vitesse − 3,5) × VEHICLE_DAMAGE` points de vie, soit la mort vers 50 km/h (13,9 m/s). */
export const VEHICLE_DAMAGE = 9.6;
const KNOCK_SPEED = 3.5;
const DEFAULT_HULL: readonly (readonly [number, number])[] = [[0, 0.8]];

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
  /**
   * Emplacements réservés en fin de tableau (J4 : les gendarmes à pied) : la simulation ne les fait ni naître ni marcher, un autre système les place
   * (`setExternal`) ; ils sont dessinés par la même foule, vus par les voitures (`forEachNear`) et évités par les passants.
   */
  reserved?: number;
}

/**
 * Un véhicule de la circulation vu par les passants (J3-3b) : position, vitesse, coque. La simulation y écrit ce que le choc a coûté au véhicule
 * (`slow`, part de vitesse perdue 0 à 0,5, comme pour le véhicule du joueur dans `PedSim.impact`), à remettre à zéro par l'appelant à chaque pas.
 */
export interface TrafficBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading?: number;
  hull?: readonly (readonly [number, number])[];
  slow: number;
  speed: number;
  hits: number;
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
  /** Véhicule mobile du joueur (J2 : le seul danger aux passages) ; null sinon. `heading` et `hull` (cercles : décalage le long du cap, rayon) donnent sa coque. */
  vehicle: { x: number; y: number; vx: number; vy: number; heading?: number; hull?: readonly (readonly [number, number])[]; hornRange?: number } | null;
  /** Les véhicules de la circulation (J3) : les passants les évitent, attendent à l'entrée d'un passage devant eux et peuvent être heurtés. */
  vehicles?: readonly TrafficBody[];
  /** Coups de klaxon des voitures de la circulation à cet instant (J3-6) : les passants devant elles sursautent comme devant celui du joueur. */
  honks?: readonly NonNullable<Observer["vehicle"]>[];
  /** Klaxon (ou sonnette) enfoncé à ce pas : les passants devant lui sursautent, jusqu'à la portée `vehicle.hornRange` (35 m par défaut). */
  horn?: boolean;
  /** Heure de jeu (0 à 24) : règle le nombre de passants (D39). Défaut : midi. */
  hour?: number;
}

/** Ce qui s'est passé à un passant à ce pas : pour les autres systèmes (J4 : témoins ; J5 : dégâts). `speed` : vitesse relative du choc (m/s). */
export interface PedEvent {
  kind: "hit" | "stumble" | "bump" | "near_miss" | "startled" | "hurt" | "killed";
  slot: number;
  x: number;
  y: number;
  speed: number;
}

/** Effet des passants sur le joueur à ce pas : le véhicule perd `slow` (0 à 0,5) de sa vitesse après un choc ; à pied, `bump` > 0 si on bouscule quelqu'un. */
export interface PedImpact {
  slow: number;
  speed: number;
  hits: number;
  bump: number;
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
  /** Passants heurtés (cumul) et ceux qui trébuchent ou sont à terre en ce moment. */
  hits: number;
  knocked: number;
  /** Cadavres présents (J5-2), et morts depuis le début (cumul). */
  corpses: number;
  deaths: number;
  /** Nombre de passants visé à cette heure, dans ce quartier, à cette vitesse ; zone du graphe piéton autour du joueur. */
  target: number;
  zone: number;
}

export const MASK_ZONE = (1 << PED.lane) | (1 << PED.path) | (1 << PED.pedestrianStreet) | (1 << PED.plaza) | (1 << PED.corner) | (1 << PED.crossing);
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
  readonly stats: PedStats = { spawns: 0, despawns: 0, alive: 0, tiers: [0, 0, 0], waiting: 0, crossing: 0, idle: 0, spawnFailures: 0, hits: 0, knocked: 0, corpses: 0, deaths: 0, target: 0, zone: ZONE.outskirts };
  /** Événements depuis le dernier `clearEvents` et effet sur le joueur au dernier pas. */
  readonly events: PedEvent[] = [];
  readonly impact: PedImpact = { slow: 0, speed: 0, hits: 0, bump: 0 };
  /** Feux de circulation (J3-3) : aux passages à feux, les passants attendent le rouge des voitures. Null : ils ne regardent que les véhicules. */
  signals: Signals | null = null;
  /** Appelé quand un emplacement reçoit un nouveau passant (le rendu l'habille). */
  onSpawn: ((slot: number, recipe: Recipe) => void) | null = null;

  private readonly n: number;
  /** Emplacements gérés par la simulation (les suivants sont réservés). */
  private readonly free: number;
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
  private readonly jx: Float32Array;
  private readonly jy: Float32Array;
  private readonly kx: Float32Array;
  private readonly ky: Float32Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly mode: Uint8Array;
  private readonly timer: Float32Array;
  private readonly fear: Float32Array;
  /** Fuite (s restantes) : le passant court, effrayé, jusqu'à la fin du compte (conducteur dont on a pris la voiture, J4). */
  private readonly panic: Float32Array;
  private readonly acc: Float32Array;
  /** Points de vie (J5). */
  private readonly hp: Float32Array;
  /** Cadavre : secondes depuis la mort, et temps d'enfoncement (0 : pas encore). */
  private readonly age: Float32Array;
  private readonly sink: Float32Array;
  /** Cap de fuite d'un passant touché (rad), pris quand il se relève ; NaN : aucun. */
  private readonly fleeDir: Float32Array;
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
    this.free = Math.max(0, n - (opt.reserved ?? 0));
    this.tiers = opt.tiers ?? true;
    this.avoid = opt.avoid ?? true;
    this.spawnPerStep = opt.spawnPerStep ?? 2;
    this.spawnRng = hash32(opt.seed, 0x51ed);
    this.state = createCrowdState(Array.from({ length: n }, () => recipeFromSeed(0)));
    this.state.alive = new Uint8Array(n);
    this.state.pose = new Uint8Array(n);
    this.state.poseT = new Float32Array(n);
    this.state.poseSide = new Int8Array(n);
    this.jx = new Float32Array(n); this.jy = new Float32Array(n); this.kx = new Float32Array(n); this.ky = new Float32Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.heading = new Float32Array(n);
    this.speed = new Float32Array(n); this.want = new Float32Array(n); this.edge = new Int32Array(n).fill(-1); this.gen = new Int32Array(n);
    this.dir = new Int8Array(n); this.s = new Float32Array(n); this.lat = new Float32Array(n); this.latTarget = new Float32Array(n);
    this.ox = new Float32Array(n); this.oy = new Float32Array(n); this.mode = new Uint8Array(n); this.timer = new Float32Array(n);
    this.fear = new Float32Array(n); this.panic = new Float32Array(n); this.acc = new Float32Array(n); this.hp = new Float32Array(n).fill(PED_HP); this.age = new Float32Array(n); this.sink = new Float32Array(n); this.fleeDir = new Float32Array(n).fill(NaN); this.rng = new Uint32Array(n); this.id = new Uint32Array(n);
    this.tier = new Uint8Array(n); this.link = new Int32Array(n).fill(-1);
  }

  get capacity(): number { return this.n; }

  /** Remplit tous les emplacements d'un coup (départ du jeu, du banc, des tests). */
  prefill(obs: Observer): void {
    this.hour = obs.hour ?? 12;
    const hit = this.graph.nearest(obs.x, obs.y, 80, MASK_ZONE);
    this.stats.zone = hit ? this.graph.edgeZone(hit.edge) : ZONE.outskirts;
    this.stats.target = crowdTarget(this.free, this.hour, this.stats.zone, Math.hypot(obs.vx, obs.vy));
    let alive = 0;
    for (let pass = 0; pass < 12 && alive < this.stats.target; pass++) {
      for (let i = 0; i < this.free && alive < this.stats.target; i++) {
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
    const imp = this.impact;
    imp.slow = imp.speed = imp.hits = imp.bump = 0;
    if (obs.horn && obs.vehicle) this.honk(obs.vehicle);
    if (obs.honks) for (const h of obs.honks) this.honk(h);
    // Quartier du joueur (zone de la file la plus proche) : deux fois par seconde suffisent.
    if (this.frame % 30 === 1) {
      const hit = this.graph.nearest(obs.x, obs.y, 80, MASK_ZONE);
      stats.zone = hit ? this.graph.edgeZone(hit.edge) : ZONE.outskirts;
    }
    stats.target = crowdTarget(this.free, this.hour, stats.zone, v);
    if (this.avoid) this.buildGrid();
    const t0 = TIER_RANGE[0] * TIER_RANGE[0], t1 = TIER_RANGE[1] * TIER_RANGE[1];
    let near = 0, mid = 0, far = 0, waiting = 0, crossing = 0, idle = 0, nAlive = 0, knocked = 0, corpses = 0;
    for (let i = 0; i < this.free; i++) {
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
      if (this.panic[i]! > 0) {
        this.panic[i] = Math.max(0, this.panic[i]! - dt);
        this.fear[i] = 1;
      } else if (this.fear[i]! > 0) this.fear[i] = Math.max(0, this.fear[i]! - dt * 0.35);
      if (this.mode[i]! >= PED_STATE.stumble) {
        this.knockedStep(i, dt, obs);
        if (!alive[i]) nAlive--;
        else if (this.mode[i] === PED_STATE.dead) corpses++;
        else knocked++;
        continue;
      }
      if (obs.vehicle) this.vehicleContact(i, obs.vehicle, this.impact);
      if (obs.vehicles) for (const tv of obs.vehicles) this.vehicleContact(i, tv, tv);
      if (obs.onFoot && d2 < 4) this.footContact(i, obs, d2);
      if (this.mode[i]! >= PED_STATE.stumble) {
        knocked++;
        continue;
      }
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
    // Les écarts à la cible se comptent en entiers : sans cela, un déficit de 1 faisait naître 2 passants, l'excès de 1 en retirait 2 (souvent les nouveaux-nés,
    // à plus de 60 m), et la foule se renouvelait en boucle à chaque pas (mesure sur téléphone : 20 naissances par seconde à l'arrêt).
    // Les cadavres (J5-2) ne comptent pas comme des passants : ils ne font ni naître ni partir les autres.
    nAlive -= corpses;
    const goal = Math.round(stats.target);
    if (nAlive > goal) {
      let leaving = Math.min(2, nAlive - goal);
      for (let k = 0; k < this.free && leaving > 0; k++) {
        const i = (this.excessCursor + k) % this.free;
        if (!alive[i] || this.mode[i] === PED_STATE.dead) continue;
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
    stats.knocked = knocked;
    stats.corpses = corpses;
    stats.tiers = [near, mid, far];
    stats.waiting = waiting;
    stats.crossing = crossing;
    stats.idle = idle;
    // Naissances : les emplacements libres se remplissent, au plus `spawnPerStep` par pas.
    let attempts = nAlive < goal ? Math.min(this.spawnPerStep, goal - nAlive) : 0;
    for (let i = 0; i < this.free && attempts > 0; i++) {
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

  private place0(i: number, edge: number, s: number, x: number, y: number, forced: number | null = null): void {
    this.spawned++;
    // Graine : monde, voie, heure de jeu et case de 6 m : la même personne se trouve au même endroit à la même heure (D39). Deux passants vivants
    // n'ont jamais la même graine (deux jumeaux côte à côte se verraient).
    const way = this.graph.edgeWay(edge) % 4294967296;
    let seed = hash32(hash32(this.opt.seed ^ way, Math.floor(this.hour)), hash32(Math.round(x / 6) + 4096, Math.round(y / 6) + 4096));
    if (forced !== null) seed = forced >>> 0;
    for (let guard = 0; guard < 8 && this.taken(i, seed); guard++) seed = hash32(seed, guard + 1);
    this.rng[i] = seed ^ 0xa511e9b3;
    this.id[i] = seed;
    const recipe = dressForCold(recipeFromSeed(seed), seed, coldAt(this.hour));
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
    this.jx[i] = this.jy[i] = this.kx[i] = this.ky[i] = 0;
    this.state.pose![i] = 0;
    this.mode[i] = PED_STATE.walk;
    this.timer[i] = 0;
    this.fear[i] = 0;
    this.panic[i] = 0;
    this.acc[i] = 0;
    this.hp[i] = PED_HP;
    this.age[i] = this.sink[i] = 0;
    this.fleeDir[i] = NaN;
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
      if (!this.threat(this.x[i]!, this.y[i]!, obs) && !this.redForWalkers(i)) this.mode[i] = PED_STATE.cross;
      return;
    }
    // Un passant effrayé (klaxon, véhicule trop près) presse le pas.
    let target = this.want[i]! * (1 + 0.6 * this.fear[i]!);
    if (this.panic[i]! > 0) target = Math.max(target, FLEE_SPEED);
    if (this.hp[i]! < WOUNDED_HP) target *= 0.7;
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

  /** Le passant est à l'entrée d'un passage à feux et le feu des piétons n'est pas au vert (les voitures roulent encore). */
  private redForWalkers(i: number): boolean {
    if (!this.signals || this.graph.edgeType(this.edge[i]!) !== PED.crossingSignal) return false;
    return this.signals.pedWalk(this.x[i]!, this.y[i]!, this.graph.edgeWay(this.edge[i]!)) === false;
  }

  private threat(x: number, y: number, obs: Observer): boolean {
    if (vehicleThreat(x, y, obs.vehicle)) return true;
    if (obs.vehicles) for (const v of obs.vehicles) if (vehicleThreat(x, y, v)) return true;
    return false;
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
      this.mode[i] = this.threat(this.x[i]!, this.y[i]!, obs) || this.redForWalkers(i) ? PED_STATE.wait : PED_STATE.cross;
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
    // Écart d'esquive (klaxon, véhicule) : une vitesse qui s'amortit, puis un retour lent vers la file.
    if (this.kx[i] !== 0 || this.ky[i] !== 0) {
      this.jx[i]! += this.kx[i]! * dt;
      this.jy[i]! += this.ky[i]! * dt;
      const damp = Math.exp(-dt * 4);
      this.kx[i]! *= damp;
      this.ky[i]! *= damp;
      if (Math.abs(this.kx[i]!) + Math.abs(this.ky[i]!) < 0.05) this.kx[i] = this.ky[i] = 0;
    } else if (this.jx[i] !== 0 || this.jy[i] !== 0) {
      const back = Math.max(0, 1 - dt * 1.5);
      this.jx[i]! *= back;
      this.jy[i]! *= back;
      if (Math.abs(this.jx[i]!) + Math.abs(this.jy[i]!) < 0.02) this.jx[i] = this.jy[i] = 0;
    }
    let px = this.pt.x + Math.cos(hd) * lat + this.jx[i]!, py = this.pt.y - Math.sin(hd) * lat + this.jy[i]!;
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

  // --- Chocs, esquives, klaxon -----------------------------------------------------------------------------------

  private event(kind: PedEvent["kind"], i: number, speed: number): void {
    if (this.events.length < 256) this.events.push({ kind, slot: i, x: this.x[i]!, y: this.y[i]!, speed });
  }

  /** Vide la liste d'événements (celui qui les lit s'en charge ; au-delà de 256 non lus, les nouveaux sont perdus). */
  clearEvents(): void {
    this.events.length = 0;
  }

  /** Esquive : une vitesse d'écart (m/s) dans la direction (dx, dy) unitaire ; le passant presse le pas. */
  private startle(i: number, dx: number, dy: number, speed: number, silent = false): void {
    this.kx[i]! += dx * speed;
    this.ky[i]! += dy * speed;
    if (this.fear[i]! < 0.5 && !silent) this.event("startled", i, speed);
    this.fear[i] = 1;
    if (this.mode[i] === PED_STATE.wait || this.mode[i] === PED_STATE.idle) this.mode[i] = PED_STATE.walk;
  }

  /** Le passant est heurté : il trébuche (choc léger) ou tombe (`kind`), avec une vitesse (m/s) dans la direction (ux, uy). */
  private knock(i: number, kind: number, ux: number, uy: number, impulse: number): void {
    this.mode[i] = kind === HIT_POSE.down ? PED_STATE.down : PED_STATE.stumble;
    this.timer[i] = kind === HIT_POSE.down ? DOWN_TIME : STUMBLE_TIME;
    this.kx[i] = ux * impulse;
    this.ky[i] = uy * impulse;
    this.fear[i] = 1;
    this.speed[i] = 0;
    const st = this.state;
    st.pose![i] = kind;
    st.poseT![i] = 0;
    // Choc de face : sur le dos ; par derrière : vers l'avant.
    st.poseSide![i] = ux * Math.sin(this.heading[i]!) + uy * Math.cos(this.heading[i]!) > 0 ? -1 : 1;
    this.stats.hits++;
  }

  /** Contact d'un passant avec la coque du véhicule du joueur, ou esquive à son approche. */
  private vehicleContact(i: number, v: NonNullable<Observer["vehicle"]>, imp: { slow: number; speed: number; hits: number }): void {
    const px = this.x[i]!, py = this.y[i]!;
    const dx = px - v.x, dy = py - v.y;
    const speed = Math.hypot(v.vx, v.vy);
    const reach = Math.max(8, 4 + speed * 1.2);
    if (dx * dx + dy * dy > reach * reach) return;
    const h = v.heading ?? Math.atan2(v.vx, v.vy);
    const fx = Math.sin(h), fy = Math.cos(h);
    let pen = 0, nx = 0, ny = 0;
    for (const [off, r] of v.hull ?? DEFAULT_HULL) {
      const ddx = px - (v.x + fx * off), ddy = py - (v.y + fy * off), d = Math.hypot(ddx, ddy);
      if (d < r + BODY && r + BODY - d > pen) {
        pen = r + BODY - d;
        nx = d > 1e-6 ? ddx / d : 1;
        ny = d > 1e-6 ? ddy / d : 0;
      }
    }
    const ux = speed > 0.1 ? v.vx / speed : fx, uy = speed > 0.1 ? v.vy / speed : fy;
    // Côté du passant par rapport à la trajectoire (vecteur unitaire d'écart).
    const lat = -dx * uy + dy * ux;
    const away = lat >= 0 ? 1 : -1;
    const ax = -uy * away, ay = ux * away;
    if (pen > 0) {
      if (speed < 1.2) {
        // Un véhicule qui avance au pas pousse le passant sans le faire tomber.
        this.jx[i]! += nx * pen;
        this.jy[i]! += ny * pen;
        this.fear[i] = Math.max(this.fear[i]!, 0.5);
        return;
      }
      const hard = speed >= 3.5;
      this.knock(i, hard ? HIT_POSE.down : HIT_POSE.stumble, ux * 0.8 + ax * 0.6, uy * 0.8 + ay * 0.6, hard ? Math.min(9, 0.7 * speed + 1.5) : 1.2 + 0.4 * speed);
      // Un véhicule qui renverse blesse (J5-2, D80) : (vitesse − 3,5) × 9,6 points de vie, la mort vers 50 km/h ; en dessous, un simple trébuchement.
      if (hard) {
        this.hp[i]! -= (speed - KNOCK_SPEED) * VEHICLE_DAMAGE;
        if (this.hp[i]! <= 0) this.kill(i);
        else if (this.hp[i]! < PED_HP) this.wound(i, ux, uy);
      }
      const slow = hard ? Math.min(0.3, Math.max(0.1, 0.1 + 0.02 * speed)) : 0.04;
      imp.slow = Math.min(0.5, 1 - (1 - imp.slow) * (1 - slow));
      imp.speed = Math.max(imp.speed, speed);
      imp.hits++;
      this.event(hard ? "hit" : "stumble", i, speed);
      return;
    }
    // À l'approche : on saute de côté si le véhicule arrive vite sur soi.
    if (speed > 2.5) {
      // `ahead` : position du passant devant le véhicule, le long de sa trajectoire.
      const ahead = dx * ux + dy * uy;
      if (ahead > 0 && ahead < 3 + speed * 1.2 && Math.abs(lat) < 2.2 && this.fear[i]! < 0.5) {
        this.startle(i, ax, ay, 5);
        if (Math.abs(lat) < 1.4) this.event("near_miss", i, speed);
      }
    }
  }

  /** Contact avec le joueur à pied : le passant cède la place, un joueur qui court le fait trébucher. */
  private footContact(i: number, obs: Observer, d2: number): void {
    const min = PLAYER_BODY + BODY;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = (this.x[i]! - obs.x) / d, ny = (this.y[i]! - obs.y) / d, pen = min - d;
    this.jx[i]! += nx * pen;
    this.jy[i]! += ny * pen;
    this.impact.bump = Math.max(this.impact.bump, 0.3);
    const vr = Math.hypot(obs.vx, obs.vy);
    if (vr > 3.5 && this.mode[i]! < PED_STATE.stumble) {
      this.knock(i, HIT_POSE.stumble, obs.vx / vr, obs.vy / vr, 1.0 + 0.3 * vr);
      this.event("stumble", i, vr);
    } else if (this.fear[i]! < 0.3) {
      this.fear[i] = 0.5;
      this.event("bump", i, vr);
    }
  }

  /** Klaxon : les passants devant le véhicule (à moins de sa portée, 35 m par défaut, ±45°) sursautent ; à moins du tiers de la portée (12 m au plus) ils sautent de côté. */
  private honk(v: NonNullable<Observer["vehicle"]>): void {
    const h = v.heading ?? Math.atan2(v.vx, v.vy);
    const fx = Math.sin(h), fy = Math.cos(h);
    const alive = this.state.alive!;
    const range = v.hornRange ?? 35, jump = Math.min(12, range / 3);
    for (let i = 0; i < this.free; i++) {
      if (!alive[i] || this.mode[i]! >= PED_STATE.stumble) continue;
      const dx = this.x[i]! - v.x, dy = this.y[i]! - v.y, d = Math.hypot(dx, dy);
      if (d > range || d < 1 || Math.abs(angleDiff(Math.atan2(dx, dy), h)) > 0.8) continue;
      const side = dx * fy - dy * fx >= 0 ? 1 : -1;
      this.startle(i, fy * side, -fx * side, d < jump ? 4 : 0, false);
      this.fear[i] = 1;
    }
  }

  /** Passant à terre ou qui trébuche : il glisse, se heurte aux murs, puis se relève et reprend sa file. */
  private knockedStep(i: number, dt: number, obs: Observer): void {
    const g = this.graph, st = this.state;
    st.poseT![i]! += dt;
    this.timer[i]! -= dt;
    const dead = this.mode[i] === PED_STATE.dead;
    const decay = Math.exp(-dt * (this.mode[i] === PED_STATE.down || dead ? 2.5 : 4));
    this.jx[i]! += this.kx[i]! * dt;
    this.jy[i]! += this.ky[i]! * dt;
    this.kx[i]! *= decay;
    this.ky[i]! *= decay;
    g.pointAt(this.edge[i]!, this.s[i]!, this.pt);
    let px = this.pt.x + this.jx[i]!, py = this.pt.y + this.jy[i]!;
    if (this.colliders) {
      const r = this.colliders.resolveInto(this.res, px, py, BODY);
      if (r.hit) {
        this.jx[i]! += r.x - px;
        this.jy[i]! += r.y - py;
        this.kx[i]! *= 0.2;
        this.ky[i]! *= 0.2;
        px = r.x;
        py = r.y;
      }
    }
    this.x[i] = px;
    this.y[i] = py;
    st.x[i] = px;
    st.z[i] = -py;
    st.y[i] = this.terrain.heightAt(px, py);
    st.yaw[i] = -this.heading[i]!;
    st.speed[i] = 0;
    if (dead) {
      this.corpseStep(i, dt, obs);
      return;
    }
    if (this.timer[i]! > 0) return;
    // Il se relève : il reprend la file piétonne la plus proche (le choc l'a peut-être emporté loin de la sienne).
    const hit = g.nearest(px, py, 25, MASK_WALK);
    if (!hit) {
      st.alive![i] = 0;
      this.stats.despawns++;
      return;
    }
    this.edge[i] = hit.edge;
    this.gen[i] = g.generation(hit.edge);
    this.s[i] = hit.s;
    const flee = this.fleeDir[i]!;
    if (this.panic[i]! > 0 && !Number.isNaN(flee)) this.heading[i] = flee;
    this.fleeDir[i] = NaN;
    const along = g.pointAt(hit.edge, hit.s, this.pt);
    this.dir[i] = Math.cos(this.heading[i]! - along) >= 0 ? 1 : -1;
    this.jx[i] = this.jy[i] = this.kx[i] = this.ky[i] = 0;
    this.ox[i] = this.oy[i] = 0;
    this.lat[i] = this.latTarget[i] = 0;
    this.speed[i] = this.want[i]! * 0.5;
    this.mode[i] = PED_STATE.walk;
    st.pose![i] = 0;
  }

  /** Cadavre : il reste au sol dans la pose de chute, puis s'enfonce doucement dans le terrain (hors de vue au bout d'une minute, au plus tard après 150 s). */
  private corpseStep(i: number, dt: number, obs: Observer): void {
    const st = this.state;
    this.age[i]! += dt;
    // La pose reste tenue au sol (ni relèvement ni retour à la marche).
    st.poseT![i] = Math.min(st.poseT![i]!, DOWN_TIME - 1.4);
    if (this.sink[i]! === 0) {
      const dx = this.x[i]! - obs.x, dy = this.y[i]! - obs.y, d = Math.hypot(dx, dy);
      const hidden = d > 30 && Math.abs(angleDiff(Math.atan2(dx, dy), obs.yaw)) > 1.0;
      if (this.age[i]! > CORPSE_MAX_LIFE || (this.age[i]! > CORPSE_HIDDEN_LIFE && (hidden || d > 60))) this.sink[i] = 1e-4;
      return;
    }
    this.sink[i]! += dt;
    if (this.sink[i]! >= SINK_TIME) {
      st.alive![i] = 0;
      this.stats.despawns++;
      return;
    }
    st.y[i]! -= SINK_DEPTH * (this.sink[i]! / SINK_TIME);
  }

  /** Le passant meurt (J5-2) : il reste à terre pour de bon ; le plus ancien cadavre s'enfonce si l'on dépasse `MAX_CORPSES`. */
  private kill(i: number): void {
    this.mode[i] = PED_STATE.dead;
    this.hp[i] = 0;
    this.age[i] = 0;
    this.sink[i] = 0;
    this.panic[i] = 0;
    this.fear[i] = 0;
    this.stats.deaths++;
    this.event("killed", i, 0);
    let count = 0, oldest = -1;
    for (let j = 0; j < this.free; j++) {
      if (!this.state.alive![j] || this.mode[j] !== PED_STATE.dead || this.sink[j]! > 0) continue;
      count++;
      if (oldest < 0 || this.age[j]! > this.age[oldest]!) oldest = j;
    }
    if (count > MAX_CORPSES && oldest >= 0) this.sink[oldest] = 1e-4;
  }

  /** Après un coup qui laisse en vie : le passant fuit (plus longtemps et en boitant s'il est blessé), loin de la direction (ux, uy) du coup. */
  private wound(i: number, ux: number, uy: number): void {
    this.panic[i] = Math.max(this.panic[i]!, this.hp[i]! < WOUNDED_HP ? WOUNDED_FLEE : HURT_FLEE);
    this.fleeDir[i] = Math.atan2(ux, uy);
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

  /**
   * Passants vivants à moins de `r` de (x, y), pour la circulation (J3-3b) : `visit(x, y, vx, vy, engaged)`, où `engaged` dit qu'ils traversent
   * (sur un passage) ou sont à terre, donc que les voitures doivent leur laisser la place. Sans allocation.
   */
  forEachNear(x: number, y: number, r: number, visit: (x: number, y: number, vx: number, vy: number, engaged: boolean) => void): void {
    const alive = this.state.alive!, r2 = r * r;
    for (let i = 0; i < this.n; i++) {
      if (!alive[i]) continue;
      const dx = this.x[i]! - x, dy = this.y[i]! - y;
      if (dx * dx + dy * dy > r2) continue;
      const m = this.mode[i]!;
      // Un cadavre récent est un obstacle ; plus ancien, la circulation passe (sinon un corps sur la chaussée la bloquerait une minute).
      if (m === PED_STATE.dead && this.age[i]! > CORPSE_BLOCKS) continue;
      const sp = m === PED_STATE.walk || m === PED_STATE.cross ? this.speed[i]! * (m === PED_STATE.cross ? 1.25 : 1) : 0;
      visit(this.x[i]!, this.y[i]!, Math.sin(this.heading[i]!) * sp, Math.cos(this.heading[i]!) * sp, m === PED_STATE.cross || m >= PED_STATE.stumble);
    }
  }

  /** Les passants vivants (pas les morts : un cadavre ne témoigne de rien) dont le centre est dans le cercle (x, y, r) : leurs emplacements sont ajoutés à `out`. Renvoie leur nombre. */
  queryCircle(x: number, y: number, r: number, out: number[]): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.state.alive![i] || this.mode[i] === PED_STATE.dead) continue;
      if (Math.hypot(this.x[i]! - x, this.y[i]! - y) <= r) {
        out.push(i);
        n++;
      }
    }
    return n;
  }

  /**
   * Fait sortir quelqu'un d'une voiture (J4 : le conducteur dont le joueur prend la voiture) : un passant de la recette `seed` apparaît en (x, y),
   * trébuche (poussé de `push` m/s dans la direction (ux, uy)), puis s'enfuit en courant pendant `FLEE_TIME` s, en s'éloignant de (fromX, fromY).
   * Un emplacement libre est pris, sinon celui du passant le plus éloigné. Renvoie l'emplacement, ou −1 s'il n'y a pas de file piétonne à 25 m.
   */
  eject(x: number, y: number, seed: number, ux: number, uy: number, push: number, fromX: number, fromY: number): number {
    const alive = this.state.alive!;
    let slot = -1, far = -1;
    for (let i = 0; i < this.free; i++) {
      if (!alive[i]) {
        slot = i;
        break;
      }
      const d = Math.hypot(this.x[i]! - x, this.y[i]! - y);
      if (d > far) {
        far = d;
        slot = i;
      }
    }
    const hit = slot < 0 ? null : this.graph.nearest(x, y, 25, MASK_WALK);
    if (!hit) return -1;
    if (alive[slot]) this.stats.despawns++;
    this.place0(slot, hit.edge, hit.s, x, y, seed);
    // Le passant est sur la file la plus proche ; son écart le met à la portière. Il trébuche, puis repart dans la direction opposée au joueur.
    this.graph.pointAt(hit.edge, hit.s, this.pt);
    this.jx[slot] = x - this.pt.x;
    this.jy[slot] = y - this.pt.y;
    this.x[slot] = x;
    this.y[slot] = y;
    this.heading[slot] = Math.atan2(x - fromX, y - fromY);
    this.knock(slot, HIT_POSE.stumble, ux, uy, push);
    this.stats.hits--;
    this.panic[slot] = FLEE_TIME;
    this.event("startled", slot, push);
    return slot;
  }

  /** Premier emplacement réservé (voir `PedSimOptions.reserved`) et leur nombre. */
  get reservedStart(): number {
    return this.free;
  }

  /**
   * Place un personnage d'un emplacement réservé (J4 : gendarme à pied) : `recipe` à sa première apparition (null pour la garder), position, cap
   * (rad, 0 = nord), vitesse (m/s, l'animation de marche ou de course la suit), pose de choc (`HIT_POSE`, 0 debout) et temps écoulé depuis le choc.
   * `on` false : l'emplacement est vide (rien n'est dessiné).
   */
  setExternal(i: number, on: boolean, recipe: Recipe | null, x: number, y: number, heading: number, speed: number, pose: number, poseT: number, dt: number): void {
    if (i < this.free || i >= this.n) return;
    const st = this.state;
    if (!on) {
      st.alive![i] = 0;
      return;
    }
    if (recipe) {
      st.recipes[i] = recipe;
      this.onSpawn?.(i, recipe);
    }
    st.alive![i] = 1;
    this.x[i] = x;
    this.y[i] = y;
    this.heading[i] = heading;
    this.speed[i] = speed;
    this.mode[i] = pose > 0 ? PED_STATE.down : PED_STATE.walk;
    st.x[i] = x;
    st.z[i] = -y;
    st.y[i] = this.terrain.heightAt(x, y);
    st.yaw[i] = -heading;
    st.speed[i] = pose > 0 ? 0 : speed;
    st.pose![i] = pose;
    st.poseT![i] = poseT;
    st.phase[i] = (st.phase[i]! + phaseRate(pose > 0 ? 0 : speed, st.recipes[i]!.height) * dt) % TAU;
  }

  /** Le passant de cet emplacement s'enfuit-il encore ? (tests, diagnostic) */
  fleeing(i: number): boolean {
    return !!this.state.alive![i] && this.panic[i]! > 0;
  }

  /**
   * Pousse un passant : impulsion (ix, iy) en m/s. Au-delà de 3,5 m/s il tombe (et se relève ensuite), en dessous il trébuche. C'est l'entrée prévue
   * pour J5 (coups, explosions, véhicules des autres) ; elle ne retire pas de santé (J5 ajoutera ses champs).
   */
  applyImpulse(i: number, ix: number, iy: number): void {
    if (i >= this.free || !this.state.alive![i] || this.mode[i]! >= PED_STATE.stumble) return;
    const v = Math.hypot(ix, iy);
    if (v < 0.05) return;
    this.knock(i, v >= 3.5 ? HIT_POSE.down : HIT_POSE.stumble, ix / v, iy / v, v);
    this.event(v >= 3.5 ? "hit" : "stumble", i, v);
  }

  /** Points de vie d'un passant (tests, diagnostic). */
  health(i: number): number {
    return this.hp[i]!;
  }

  /**
   * Passants debout (ni à terre ni qui trébuchent) dans le cône de cap `heading` et de demi-angle `halfAngle`, à moins de `range` de (x, y) mesuré
   * de centre à centre moins le rayon du corps ; leurs emplacements, du plus proche au plus loin (au plus `max`), dans `out` (vidé d'abord).
   * Les emplacements réservés (gendarmes) ne sont pas des cibles du joueur ici. Sans allocation.
   */
  pick(x: number, y: number, heading: number, range: number, halfAngle: number, max: number, out: number[]): number {
    out.length = 0;
    const alive = this.state.alive!, reach = range + BODY;
    for (let i = 0; i < this.free; i++) {
      if (!alive[i] || this.mode[i]! >= PED_STATE.stumble) continue;
      const dx = this.x[i]! - x, dy = this.y[i]! - y, d = Math.hypot(dx, dy);
      if (d > reach) continue;
      // Tout contre le joueur (moins de 0,4 m), l'angle ne veut plus rien dire : il est dans le cône.
      if (d > 0.4 && Math.abs(angleDiff(Math.atan2(dx, dy), heading)) > halfAngle) continue;
      // Insertion triée (au plus `max` éléments, très petit).
      let k = out.length;
      if (k < max) out.push(i);
      else if (d >= Math.hypot(this.x[out[k - 1]!]! - x, this.y[out[k - 1]!]! - y)) continue;
      else k--;
      while (k > 0 && Math.hypot(this.x[out[k - 1]!]! - x, this.y[out[k - 1]!]! - y) > d) {
        out[k] = out[k - 1]!;
        k--;
      }
      out[k] = i;
    }
    return out.length;
  }

  /**
   * Frappe un passant (J5, D80) : retire `amount` points de vie, le pousse de `impulse` m/s dans la direction (ux, uy) (trébuche ou tombe, comme
   * `applyImpulse`), et le fait fuir loin du coup (blessé sous 40 points : plus longtemps, et il boite). À 0 point il meurt : il reste à terre
   * (`MAX_CORPSES` cadavres au plus). Renvoie 0 (rien : emplacement réservé, absent, déjà à terre ou mort), 1 (touché), 2 (tué).
   */
  damage(i: number, amount: number, ux: number, uy: number, impulse: number): number {
    if (i >= this.free || !this.state.alive![i] || this.mode[i]! >= PED_STATE.stumble || !(amount > 0)) return 0;
    this.hp[i]! -= amount;
    const dead = this.hp[i]! <= 0;
    const v = Math.max(impulse, dead ? 4 : 0);
    const len = Math.hypot(ux, uy) || 1;
    this.knock(i, v >= KNOCK_SPEED ? HIT_POSE.down : HIT_POSE.stumble, ux / len, uy / len, v);
    this.event("hurt", i, v);
    if (dead) this.kill(i);
    else this.wound(i, ux, uy);
    return dead ? 2 : 1;
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

