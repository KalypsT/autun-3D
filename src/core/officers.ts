import { DOWN_TIME, GUN_POSE, HIT_POSE, STUMBLE_TIME } from "./character-rig";
import type { Colliders, Resolution } from "./collision";
import type { VehicleSpec, VehicleState } from "./vehicle";

/**
 * Gendarmes à pied (J4, D75) : logique pure. Ils descendent d'une voiture de police arrêtée près du joueur, courent vers lui (un peu moins vite que
 * lui : à pied, on peut leur échapper), l'arrêtent s'ils restent à son contact, et remontent dans leur voiture quand il s'en va en roulant.
 * Un véhicule qui les heurte les fait trébucher ou tomber (comme un passant, D44) : c'est une infraction (`hits`).
 *
 * J5-5 (D85) : à quatre étoiles et plus, ils sont armés (un pistolet) : au lieu d'arrêter le joueur ils s'arrêtent à 10 m et tirent (un tir toutes les
 * 1,2 s environ, précision qui baisse avec la distance et la vitesse du joueur) ; ils ont 100 points de vie, le joueur peut les frapper et les abattre
 * (un gendarme tué lâche son pistolet), et un véhicule qui les renverse vite les tue (comme un passant, D82).
 */

export const OFFICER = {
  /** Vitesse de course (m/s) : le joueur court à 5 m/s. */
  speed: 4.7,
  radius: 0.3,
  /** Arrestation à pied : un gendarme à moins de … m pendant … s cumulées. */
  footReach: 1.2,
  footTime: 1.5,
  /** Arrestation en voiture : à l'arrêt (moins de 1 m/s), un gendarme à moins de … m du centre de la voiture pendant … s. */
  carReach: 3.2,
  carTime: 2,
  /** Gendarmes à pied au plus (vivants). */
  max: 6,
  /** Points de vie (J5-5). */
  hp: 100,
  /** Armés : distance de tir (m), distance où ils s'arrêtent, délai avant le premier tir (s), cadence (s entre deux tirs), dégâts d'une balle qui porte. */
  shootRange: 35,
  holdDistance: 10,
  reaction: 0.6,
  fireEvery: 1.2,
  damage: 12,
  /** Au plus … gendarmes tirent en même temps (les plus proches du joueur) : les autres visent et couvrent (sans cela six gendarmes tuent en deux secondes). */
  maxShooters: 3,
  /** Un gendarme mort reste au sol (s) puis disparaît. */
  corpseLife: 40,
} as const;

/** Chance qu'un tir de gendarme touche : décroît avec la distance et la vitesse du joueur, moins précis en courant. Fonction pure (tests, voitures de police à cinq étoiles). */
export function shotHitChance(distance: number, targetSpeed: number, shooterMoving: boolean): number {
  const base = Math.min(0.8, Math.max(0.15, 0.8 - 0.017 * distance));
  return base * (1 - Math.min(0.55, targetSpeed * 0.11)) * (shooterMoving ? 0.6 : 1);
}

/** Un tir de gendarme, pour le rendu (trait et éclair) : de (x0, y0) à (x1, y1) ; `hit` : il a touché le joueur. */
export interface OfficerShot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hit: boolean;
}

export type OfficerMode = "run" | "back" | "stumble" | "down" | "dead";

export interface Officer {
  x: number;
  y: number;
  heading: number;
  speed: number;
  mode: OfficerMode;
  /** Temps restant au sol ou en trébuchant (s), et temps depuis le choc (pose). */
  timer: number;
  poseT: number;
  /** Glissade après un choc (m/s). */
  kx: number;
  ky: number;
  /** Voiture d'où il vient (identifiant de la simulation) et graine de sa recette. */
  car: number;
  seed: number;
  /** Rang dans la liste des emplacements réservés de la foule (stable tant qu'il est dehors). */
  slot: number;
  /** Points de vie ; armé (pistolet en main) ; en train de viser ; secondes depuis le dernier tir ; temps de visée, délai avant le prochain tir ; secondes depuis la mort. */
  hp: number;
  armed: boolean;
  aiming: boolean;
  sinceShot: number;
  aimT: number;
  cool: number;
  age: number;
  rng: number;
}

/** Ce que les gendarmes savent du joueur. */
export interface Suspect {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Le véhicule qu'il conduit, ou null à pied. */
  vehicle: { state: VehicleState; spec: VehicleSpec } | null;
}

export class Officers {
  readonly list: Officer[] = [];
  /** Progression de l'arrestation (0 à 1) ; `arrested` passe à vrai à 1. */
  progress = 0;
  arrested = false;
  /** Gendarmes heurtés depuis le dernier `takeHits` (infraction « policier bousculé »). */
  private hits = 0;
  /** Tirs partis à ce pas (le rendu les lit puis les efface avec `clearShots`), points de vie retirés au joueur depuis le dernier `takeDamage`, gendarmes tués (position) depuis `takeDeaths`. */
  readonly shots: OfficerShot[] = [];
  private damage = 0;
  /** Distances des gendarmes qui courent (tri pour le plafond de tireurs) et distance du dernier des tireurs autorisés à ce pas. */
  private readonly ranks: number[] = [];
  private fireLimit = Infinity;
  private readonly deaths: { x: number; y: number }[] = [];
  private killed = 0;
  private readonly res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };

  constructor(private readonly colliders: Colliders | null) {}

  /** Un gendarme descend de la voiture `car` en (x, y) ; null s'il y en a déjà `OFFICER.max` dehors. */
  spawn(x: number, y: number, heading: number, car: number, seed: number): Officer | null {
    if (this.alive() >= OFFICER.max) return null;
    // Les cadavres occupent un emplacement de la foule : si tous sont pris, le plus ancien cadavre part.
    if (this.list.length >= OFFICER.max) {
      let oldest = -1;
      for (let i = 0; i < this.list.length; i++) if (this.list[i]!.mode === "dead" && (oldest < 0 || this.list[i]!.age > this.list[oldest]!.age)) oldest = i;
      if (oldest < 0) return null;
      this.list.splice(oldest, 1);
    }
    const used = new Set(this.list.map((o) => o.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const o: Officer = { x, y, heading, speed: 0, mode: "run", timer: 0, poseT: 0, kx: 0, ky: 0, car, seed, slot, hp: OFFICER.hp, armed: false, aiming: false, sinceShot: 9, aimT: 0, cool: 0, age: 0, rng: (seed ^ 0x9e3779b9) >>> 0 || 1 };
    this.list.push(o);
    return o;
  }

  /** Gendarmes vivants dehors. */
  alive(): number {
    let n = 0;
    for (const o of this.list) if (o.mode !== "dead") n++;
    return n;
  }

  /** Gendarmes vivants dehors de la voiture `car`. */
  countOf(car: number): number {
    let n = 0;
    for (const o of this.list) if (o.car === car && o.mode !== "dead") n++;
    return n;
  }

  /** Points de vie retirés au joueur par les tirs depuis le dernier appel (remis à zéro). */
  takeDamage(): number {
    const d = this.damage;
    this.damage = 0;
    return d;
  }

  clearShots(): void {
    this.shots.length = 0;
  }

  /** Gendarmes tués depuis le dernier appel : leur position (le jeu y laisse tomber leur pistolet), et leur nombre pour l'infraction. */
  takeDeaths(out: { x: number; y: number }[]): number {
    const n = this.killed;
    for (const d of this.deaths) out.push(d);
    this.deaths.length = 0;
    this.killed = 0;
    return n;
  }

  /**
   * Le joueur frappe ou tire sur le gendarme de l'emplacement `slot` : points de vie en moins, impulsion (m/s) dans la direction (ux, uy) (trébuche ou tombe).
   * Renvoie 0 (rien : inconnu, mort), 1 (touché), 2 (tué). Un gendarme à terre prend le coup sans retomber.
   */
  hurt(slot: number, damage: number, ux: number, uy: number, impulse: number): number {
    const o = this.list.find((q) => q.slot === slot);
    if (!o || o.mode === "dead" || o.mode === "stumble" || !(damage > 0)) return 0;
    o.hp -= damage;
    if (o.hp <= 0) {
      this.die(o, ux, uy, Math.max(impulse, 3));
      return 2;
    }
    if (o.mode !== "down") this.knockSoft(o, impulse >= 3.5 ? HIT_POSE.down : HIT_POSE.stumble, ux, uy, impulse);
    return 1;
  }

  private die(o: Officer, ux: number, uy: number, impulse: number): void {
    // Il tombe depuis le début de la chute, sauf s'il était déjà à terre.
    if (o.mode !== "down") o.poseT = 0;
    o.mode = "dead";
    o.hp = 0;
    o.age = 0;
    o.aiming = false;
    o.kx = ux * impulse;
    o.ky = uy * impulse;
    o.speed = 0;
    this.killed++;
    this.deaths.push({ x: o.x, y: o.y });
  }

  private roll(o: Officer): number {
    o.rng = (Math.imul(o.rng, 1664525) + 1013904223) >>> 0;
    return o.rng / 4294967296;
  }

  /** Les gendarmes de la voiture `car` (ou tous, avec −1) retournent à leur voiture. */
  recall(car: number): void {
    for (const o of this.list) if (car < 0 || o.car === car) if (o.mode === "run") {
      o.mode = "back";
      o.aiming = false;
    }
  }

  takeHits(): number {
    const h = this.hits;
    this.hits = 0;
    return h;
  }

  clear(): void {
    this.list.length = 0;
    this.progress = 0;
    this.arrested = false;
    this.hits = 0;
    this.shots.length = 0;
    this.damage = 0;
    this.deaths.length = 0;
    this.killed = 0;
  }

  /**
   * Un pas : chocs avec le véhicule du joueur (ou le joueur qui leur court dedans), course vers le joueur ou vers la voiture, arrestation.
   * `carAt(id)` : position de la voiture d'un gendarme (null si elle n'existe plus : il disparaît en l'atteignant… ou tout de suite).
   */
  step(dt: number, p: Suspect, carAt: (id: number) => { x: number; y: number } | null, armed = false): void {
    // Un pas négatif ou nul ne fait rien (il aurait fait grimper la progression de l'arrestation, même sans gendarme).
    if (!(dt > 0)) return;
    const veh = p.vehicle;
    const vspeed = veh ? Math.hypot(veh.state.vx, veh.state.vy) : Math.hypot(p.vx, p.vy);
    let touching = false;
    // Armés : seuls les `maxShooters` plus proches tirent (les autres visent et attendent leur tour).
    if (armed) {
      const ds = this.ranks;
      ds.length = 0;
      for (const q of this.list) if (q.mode === "run") ds.push(Math.hypot(p.x - q.x, p.y - q.y));
      ds.sort((a, b) => a - b);
      this.fireLimit = ds.length > OFFICER.maxShooters ? ds[OFFICER.maxShooters - 1]! : Infinity;
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i]!;
      if (o.mode === "dead") {
        o.age += dt;
        o.poseT += dt;
        o.x += o.kx * dt;
        o.y += o.ky * dt;
        const damp = Math.exp(-dt * 3);
        o.kx *= damp;
        o.ky *= damp;
        this.collide(o);
        if (o.age > OFFICER.corpseLife) this.list.splice(i, 1);
        continue;
      }
      o.armed = armed;
      o.sinceShot += dt;
      o.cool = Math.max(0, o.cool - dt);
      // Choc : la coque du véhicule du joueur, ou le joueur à pied qui court.
      if (o.mode !== "down" && o.mode !== "stumble") {
        if (veh) this.vehicleContact(o, veh.state, veh.spec);
        else if (vspeed > 3.5 && Math.hypot(o.x - p.x, o.y - p.y) < OFFICER.radius + 0.35) this.knock(o, HIT_POSE.stumble, p.vx / vspeed, p.vy / vspeed, 1.2);
      }
      if (o.mode === "down" || o.mode === "stumble") {
        o.timer -= dt;
        o.poseT += dt;
        o.x += o.kx * dt;
        o.y += o.ky * dt;
        const damp = Math.exp(-dt * 3);
        o.kx *= damp;
        o.ky *= damp;
        o.speed = 0;
        if (o.timer <= 0) {
          o.mode = "run";
          o.poseT = 0;
        }
        o.aiming = false;
        this.collide(o);
        continue;
      }
      let tx = p.x, ty = p.y, stopAt = veh ? 2.4 : 0.8;
      let speedCap: number = OFFICER.speed;
      // Armés (J5-5) : on ne s'approche pas de plus de 10 m, on avance vers 14 m en visant (plus lentement), on tire à portée sans mur entre eux et le joueur.
      o.aiming = false;
      if (armed && o.mode === "run") {
        stopAt = OFFICER.holdDistance;
        const dd = Math.hypot(p.x - o.x, p.y - o.y);
        if (dd <= OFFICER.shootRange && (!this.colliders || this.colliders.raycast(o.x, o.y, p.x, p.y) === null)) {
          o.aiming = true;
          o.aimT += dt;
          if (dd > OFFICER.holdDistance + 4) speedCap = 2.2;
          if (o.aimT >= OFFICER.reaction && o.cool <= 0 && dd <= this.fireLimit) this.fire(o, p, dd, vspeed, o.speed > 0.5);
        } else o.aimT = 0;
      } else o.aimT = 0;
      if (o.mode === "back") {
        const c = carAt(o.car);
        if (!c) {
          this.list.splice(i, 1);
          continue;
        }
        tx = c.x;
        ty = c.y;
        stopAt = 1.6;
      }
      const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
      if (o.mode === "back" && d < stopAt) {
        this.list.splice(i, 1);
        continue;
      }
      const want = d > stopAt ? Math.min(speedCap, 1.5 * (d - stopAt) + 1) : 0;
      o.speed += Math.max(-8 * dt, Math.min(6 * dt, want - o.speed));
      if (d > 0.05) o.heading = Math.atan2(dx, dy);
      o.x += Math.sin(o.heading) * o.speed * dt;
      o.y += Math.cos(o.heading) * o.speed * dt;
      this.collide(o);
      if (o.mode === "run") {
        const reach = Math.hypot(p.x - o.x, p.y - o.y);
        if (!armed && (veh ? reach < OFFICER.carReach && vspeed < 1 : reach < OFFICER.footReach)) touching = true;
      }
    }
    // Arrestation : le contact s'accumule, et retombe deux fois moins vite quand il est rompu.
    const need = veh ? OFFICER.carTime : OFFICER.footTime;
    this.progress = touching ? this.progress + dt / need : Math.max(0, this.progress - dt / (2 * need));
    if (this.progress >= 1) {
      this.progress = 1;
      this.arrested = true;
    }
  }

  /** Un tir : touche avec `shotHitChance` (le joueur est un point : à la hauteur du torse), sinon passe à 1 à 2 m à côté. */
  private fire(o: Officer, p: Suspect, d: number, targetSpeed: number, moving: boolean): void {
    o.cool = OFFICER.fireEvery * (0.85 + 0.3 * this.roll(o));
    o.sinceShot = 0;
    const hit = this.roll(o) < shotHitChance(d, targetSpeed, moving);
    let tx = p.x, ty = p.y;
    if (hit) this.damage += OFFICER.damage;
    else {
      const side = this.roll(o) < 0.5 ? -1 : 1, off = 0.8 + 1.2 * this.roll(o);
      const ux = (p.x - o.x) / (d || 1), uy = (p.y - o.y) / (d || 1);
      tx += -uy * side * off + ux * 3;
      ty += ux * side * off + uy * 3;
    }
    if (this.shots.length < 32) this.shots.push({ x0: o.x + Math.sin(o.heading) * 0.55, y0: o.y + Math.cos(o.heading) * 0.55, x1: tx, y1: ty, hit });
  }

  private collide(o: Officer): void {
    if (!this.colliders) return;
    const r = this.colliders.resolveInto(this.res, o.x, o.y, OFFICER.radius);
    if (r.hit) {
      o.x = r.x;
      o.y = r.y;
    }
  }

  private knock(o: Officer, kind: number, ux: number, uy: number, impulse: number): void {
    this.knockSoft(o, kind, ux, uy, impulse);
    this.hits++;
  }

  /** Chute ou trébuchement sans compter d'infraction « policier bousculé » (coup du joueur : c'est `hurt` qui en répond). */
  private knockSoft(o: Officer, kind: number, ux: number, uy: number, impulse: number): void {
    o.mode = kind === HIT_POSE.down ? "down" : "stumble";
    o.timer = kind === HIT_POSE.down ? DOWN_TIME : STUMBLE_TIME;
    o.poseT = 0;
    o.kx = ux * impulse;
    o.ky = uy * impulse;
    o.speed = 0;
    o.aiming = false;
  }

  /** La coque du véhicule touche le gendarme : poussé au pas, il trébuche jusqu'à 3,5 m/s, tombe au-delà (D44). */
  private vehicleContact(o: Officer, s: VehicleState, spec: VehicleSpec): void {
    const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
    let pen = 0, nx = 0, ny = 0;
    for (const [off, r] of spec.hull) {
      const dx = o.x - (s.x + fx * off), dy = o.y - (s.y + fy * off), d = Math.hypot(dx, dy);
      if (d < r + OFFICER.radius && r + OFFICER.radius - d > pen) {
        pen = r + OFFICER.radius - d;
        nx = d > 1e-6 ? dx / d : 1;
        ny = d > 1e-6 ? dy / d : 0;
      }
    }
    if (pen <= 0) return;
    o.x += nx * pen;
    o.y += ny * pen;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < 1.2) return;
    const ux = s.vx / speed, uy = s.vy / speed;
    if (speed >= 3.5) {
      this.knock(o, HIT_POSE.down, ux * 0.8 + nx * 0.6, uy * 0.8 + ny * 0.6, Math.min(9, 0.7 * speed + 1.5));
      // Comme un passant (D82) : (vitesse − 3,5) × 9,6 points de vie, la mort vers 50 km/h.
      o.hp -= (speed - 3.5) * 9.6;
      if (o.hp <= 0) this.die(o, ux, uy, 4);
    } else this.knock(o, HIT_POSE.stumble, nx, ny, 1.2 + 0.4 * speed);
  }

  /** Pose à dessiner (`HIT_POSE`, 0 debout). */
  static pose(o: Officer): number {
    if (o.mode === "dead" || o.mode === "down") return HIT_POSE.down;
    if (o.mode === "stumble") return HIT_POSE.stumble;
    // Armé : visée (3) ou pistolet bas pendant la course (4).
    if (o.armed) return o.aiming ? GUN_POSE.aim : GUN_POSE.ready;
    return 0;
  }
}
