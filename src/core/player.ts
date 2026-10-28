import type { Colliders } from "./collision";
import type { HeightField } from "../data/types";

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
  // Limites du monde (3 m de marge).
  x = Math.min(Math.max(x, terrain.xMin + 3), terrain.xMax - 3);
  y = Math.min(Math.max(y, terrain.yMin + 3), terrain.yMax - 3);
  p.x = x;
  p.y = y;
  p.z = terrain.heightAt(x, y, p.z);
  p.speed = Math.hypot(p.vx, p.vy);
  if (p.speed > 0.15) {
    const target = Math.atan2(p.vx, p.vy);
    p.heading += angleDelta(p.heading, target) * Math.min(1, TURN_RATE * dt);
  }
  p.stride += p.speed * dt * 2.2;
}
