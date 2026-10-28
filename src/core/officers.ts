import { DOWN_TIME, HIT_POSE, STUMBLE_TIME } from "./character-rig";
import type { Colliders, Resolution } from "./collision";
import type { VehicleSpec, VehicleState } from "./vehicle";

/**
 * Gendarmes à pied (J4, D75) : logique pure. Ils descendent d'une voiture de police arrêtée près du joueur, courent vers lui (un peu moins vite que
 * lui : à pied, on peut leur échapper), l'arrêtent s'ils restent à son contact, et remontent dans leur voiture quand il s'en va en roulant.
 * Un véhicule qui les heurte les fait trébucher ou tomber (comme un passant, D44) : c'est une infraction (`hits`). Pas d'arme (D70).
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
  /** Gendarmes à pied au plus. */
  max: 6,
} as const;

export type OfficerMode = "run" | "back" | "stumble" | "down";

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
  private readonly res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };

  constructor(private readonly colliders: Colliders | null) {}

  /** Un gendarme descend de la voiture `car` en (x, y) ; null s'il y en a déjà `OFFICER.max` dehors. */
  spawn(x: number, y: number, heading: number, car: number, seed: number): Officer | null {
    if (this.list.length >= OFFICER.max) return null;
    const used = new Set(this.list.map((o) => o.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const o: Officer = { x, y, heading, speed: 0, mode: "run", timer: 0, poseT: 0, kx: 0, ky: 0, car, seed, slot };
    this.list.push(o);
    return o;
  }

  /** Gendarmes dehors de la voiture `car`. */
  countOf(car: number): number {
    let n = 0;
    for (const o of this.list) if (o.car === car) n++;
    return n;
  }

  /** Les gendarmes de la voiture `car` (ou tous, avec −1) retournent à leur voiture. */
  recall(car: number): void {
    for (const o of this.list) if (car < 0 || o.car === car) if (o.mode === "run") o.mode = "back";
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
  }

  /**
   * Un pas : chocs avec le véhicule du joueur (ou le joueur qui leur court dedans), course vers le joueur ou vers la voiture, arrestation.
   * `carAt(id)` : position de la voiture d'un gendarme (null si elle n'existe plus : il disparaît en l'atteignant… ou tout de suite).
   */
  step(dt: number, p: Suspect, carAt: (id: number) => { x: number; y: number } | null): void {
    const veh = p.vehicle;
    const vspeed = veh ? Math.hypot(veh.state.vx, veh.state.vy) : Math.hypot(p.vx, p.vy);
    let touching = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i]!;
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
        this.collide(o);
        continue;
      }
      let tx = p.x, ty = p.y, stopAt = veh ? 2.4 : 0.8;
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
      const want = d > stopAt ? Math.min(OFFICER.speed, 1.5 * (d - stopAt) + 1) : 0;
      o.speed += Math.max(-8 * dt, Math.min(6 * dt, want - o.speed));
      if (d > 0.05) o.heading = Math.atan2(dx, dy);
      o.x += Math.sin(o.heading) * o.speed * dt;
      o.y += Math.cos(o.heading) * o.speed * dt;
      this.collide(o);
      if (o.mode === "run") {
        const reach = Math.hypot(p.x - o.x, p.y - o.y);
        if (veh ? reach < OFFICER.carReach && vspeed < 1 : reach < OFFICER.footReach) touching = true;
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

  private collide(o: Officer): void {
    if (!this.colliders) return;
    const r = this.colliders.resolveInto(this.res, o.x, o.y, OFFICER.radius);
    if (r.hit) {
      o.x = r.x;
      o.y = r.y;
    }
  }

  private knock(o: Officer, kind: number, ux: number, uy: number, impulse: number): void {
    o.mode = kind === HIT_POSE.down ? "down" : "stumble";
    o.timer = kind === HIT_POSE.down ? DOWN_TIME : STUMBLE_TIME;
    o.poseT = 0;
    o.kx = ux * impulse;
    o.ky = uy * impulse;
    o.speed = 0;
    this.hits++;
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
    if (speed >= 3.5) this.knock(o, HIT_POSE.down, ux * 0.8 + nx * 0.6, uy * 0.8 + ny * 0.6, Math.min(9, 0.7 * speed + 1.5));
    else this.knock(o, HIT_POSE.stumble, nx, ny, 1.2 + 0.4 * speed);
  }

  /** Pose à dessiner (`HIT_POSE`, 0 debout). */
  static pose(o: Officer): number {
    return o.mode === "down" ? HIT_POSE.down : o.mode === "stumble" ? HIT_POSE.stumble : 0;
  }
}
