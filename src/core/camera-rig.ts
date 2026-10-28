import type { Colliders } from "./collision";
import type { HeightField } from "../data/types";

/** Caméra à la troisième personne : orbite autour de la tête du piéton, sans traverser les murs ni le sol. */

export interface RigInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface RigResult {
  x: number;
  y: number;
  z: number;
  /** Distance réellement obtenue après les collisions. */
  distance: number;
}

export const HEAD_HEIGHT = 1.55;
export const MIN_DISTANCE = 0.6;
const WALL_MARGIN = 0.35;

export function solveCamera(input: RigInput, colliders: Colliders, terrain: HeightField): RigResult {
  const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
  // La caméra est derrière le regard : opposée au vecteur « avant ».
  const dx = -Math.sin(input.yaw) * cp, dy = -Math.cos(input.yaw) * cp, dz = sp;
  const tz = input.z + HEAD_HEIGHT;
  let d = input.distance;
  const horizontal = Math.hypot(dx, dy) * d;
  if (horizontal > 1e-6) {
    const t = colliders.raycast(input.x, input.y, input.x + dx * d, input.y + dy * d);
    if (t !== null) d = Math.max(MIN_DISTANCE, d * t - WALL_MARGIN / Math.max(Math.hypot(dx, dy), 0.2));
  }
  let x = input.x + dx * d, y = input.y + dy * d, z = tz + dz * d;
  // Le sol ne doit pas masquer la caméra ; si on la remonte, on la rapproche pour garder l'axe de visée.
  const floor = terrain.heightAt(x, y, tz) + 0.35;
  if (z < floor) {
    z = floor;
  }
  // Un dernier contrôle : la caméra elle-même ne reste pas dans un mur.
  const fix = colliders.resolve(x, y, 0.25);
  x = fix.x;
  y = fix.y;
  return { x, y, z, distance: Math.hypot(x - input.x, y - input.y, z - tz) };
}
