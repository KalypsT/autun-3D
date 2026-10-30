import type { Colliders } from "./collision";
import type { HeightField } from "../data/types";
import { holdShore, WADE_DEPTH } from "./shore";

/** Piéton : logique pure. Repère : x est, y nord, z haut ; cap 0 = nord, sens horaire (comme le soleil). */

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Direction du regard du corps, radians. */
  heading: number;
  /** Vitesse horizontale (m/s). */
  speed: number;
  /** Phase de la marche (radians), pour l'animation. */
  stride: number;
}

export interface MoveInput {
  /** Avant (+1) / arrière (-1) par rapport à la caméra. */
  forward: number;
  /** Droite (+1) / gauche (-1). */
  right: number;
  /** Course : vitesse maximale au lieu de la marche. */
  run: boolean;
}

export const PLAYER_RADIUS = 0.35;
export const WALK_SPEED = 2.0;
export const RUN_SPEED = 5.0;
const ACCEL = 14;
const FRICTION = 16;
const TURN_RATE = 12;

export function createPlayer(x: number, y: number, terrain: HeightField, heading = 0): PlayerState {
  return { x, y, z: terrain.heightAt(x, y), vx: 0, vy: 0, heading, speed: 0, stride: 0 };
}

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** Fait avancer le piéton de `dt` secondes ; `camYaw` oriente « avant » et « droite ». */
export function stepPlayer(p: PlayerState, input: MoveInput, camYaw: number, dt: number, terrain: HeightField, colliders: Colliders): void {
  const mag = Math.min(Math.hypot(input.forward, input.right), 1);
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  // Avant = (sin, cos) ; droite = (cos, -sin).
  const dirX = input.forward * sin + input.right * cos;
  const dirY = input.forward * cos - input.right * sin;
  const len = Math.hypot(dirX, dirY);
  const top = input.run ? RUN_SPEED : WALK_SPEED;
  const targetSpeed = mag * top;
  const tx = len > 1e-6 ? (dirX / len) * targetSpeed : 0;
  const ty = len > 1e-6 ? (dirY / len) * targetSpeed : 0;

  // Accélération vers la vitesse visée, frottement quand on lâche.
  const rate = mag > 0.01 ? ACCEL : FRICTION;
  const dvx = tx - p.vx, dvy = ty - p.vy;
  const dv = Math.hypot(dvx, dvy);
  const maxDv = rate * dt;
  if (dv <= maxDv) {
    p.vx = tx;
    p.vy = ty;
  } else {
    p.vx += (dvx / dv) * maxDv;
    p.vy += (dvy / dv) * maxDv;
  }

  let x = p.x + p.vx * dt, y = p.y + p.vy * dt;
  const r = colliders.resolve(x, y, PLAYER_RADIUS);
  x = r.x;
  y = r.y;
  if (r.hit) {
    // On glisse le long de l'obstacle : on retire la part de vitesse qui entre dedans.
    const into = p.vx * r.nx + p.vy * r.ny;
    if (into < 0) {
      p.vx -= into * r.nx;
      p.vy -= into * r.ny;
    }
  }
  // Limites du monde (3 m de marge), puis la mer : on y entre jusqu'à la taille, pas plus loin (D105).
  x = Math.min(Math.max(x, terrain.xMin + 3), terrain.xMax - 3);
  y = Math.min(Math.max(y, terrain.yMin + 3), terrain.yMax - 3);
  const shore = holdShore(terrain, p.x, p.y, x, y, WADE_DEPTH);
  if (shore.blocked) {
    if (shore.x === p.x) p.vx = 0;
    if (shore.y === p.y) p.vy = 0;
  }
  p.x = shore.x;
  p.y = shore.y;
  p.z = terrain.heightAt(x, y, p.z);
  p.speed = Math.hypot(p.vx, p.vy);
  if (p.speed > 0.15) {
    const target = Math.atan2(p.vx, p.vy);
    p.heading += angleDelta(p.heading, target) * Math.min(1, TURN_RATE * dt);
  }
  p.stride += p.speed * dt * 2.2;
}

/** Glissade au sol après une chute (D98) : décélération (m/s², pilote qui frotte sur la chaussée, ≈ 0,7 g). */
export const SLIDE_DECEL = 7;

/** Pilote tombé : il glisse dans le sens de sa vitesse jusqu'à l'arrêt, le long des obstacles, sans tourner ni marcher. */
export function slidePlayer(p: PlayerState, dt: number, terrain: HeightField, colliders: Colliders): void {
  const v = Math.hypot(p.vx, p.vy);
  const k = v > 0 ? Math.max(v - SLIDE_DECEL * dt, 0) / v : 0;
  p.vx *= k;
  p.vy *= k;
  const r = colliders.resolve(p.x + p.vx * dt, p.y + p.vy * dt, PLAYER_RADIUS);
  if (r.hit) {
    const into = p.vx * r.nx + p.vy * r.ny;
    if (into < 0) {
      p.vx -= into * r.nx;
      p.vy -= into * r.ny;
    }
  }
  const shore = holdShore(terrain, p.x, p.y, Math.min(Math.max(r.x, terrain.xMin + 3), terrain.xMax - 3), Math.min(Math.max(r.y, terrain.yMin + 3), terrain.yMax - 3), WADE_DEPTH);
  p.x = shore.x;
  p.y = shore.y;
  p.z = terrain.heightAt(p.x, p.y, p.z);
  p.speed = 0;
}
