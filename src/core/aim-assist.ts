import type { ShootWorld } from "./gun";

/**
 * Aide à la visée du mode visée (T2, D206). Logique pure.
 *
 * Analogie : un aimant faible caché derrière chaque passant. Quand le viseur passe sur quelqu'un, il **colle** (le doigt fait tourner le regard
 * moins vite : on ne dépasse pas la cible) ; quand on tourne ou qu'on marche avec quelqu'un près du viseur, il est **attiré** doucement vers sa
 * poitrine (on suit une cible qui bouge). Sans geste, rien ne bouge tout seul : l'aide ne vise jamais à la place du joueur, et elle vise le
 * corps, pas la tête (la tête reste au joueur).
 */

export type AimAssistLevel = 0 | 1 | 2;

interface LevelDef {
  /** Rayon de la zone d'aide autour de la poitrine (m, à la distance de la cible), bornes de son angle (rad). */
  radius: number;
  minAngle: number;
  maxAngle: number;
  /** Part du geste retirée au centre de la zone (0 à 1). */
  friction: number;
  /** Vitesse d'attraction (par seconde) au centre de la zone. */
  pull: number;
}

/** Aucune, légère, forte. */
export const AIM_ASSIST: readonly (LevelDef | null)[] = [
  null,
  { radius: 0.9, minAngle: 0.03, maxAngle: 0.16, friction: 0.35, pull: 3 },
  { radius: 1.4, minAngle: 0.05, maxAngle: 0.24, friction: 0.55, pull: 7 },
];

/** Hauteur visée sur un corps (part de sa hauteur) : la poitrine. */
const CHEST = 0.68;
/** Vitesse du joueur (m/s) au-dessus de laquelle l'attraction joue même sans geste du regard (on suit la cible en marchant). */
const MOVING = 0.3;
/** Demi-angle (rad) du cône où l'on cherche des cibles autour du regard, et nombre de candidats. */
const SEARCH_ANGLE = 0.45;
const SEARCH_MAX = 6;

/** Ce que l'aide demande : le regard de la caméra et ce qu'il y a autour. */
export interface AimAssistInput {
  /** Caméra : position (x est, y nord, z haut), cap et inclinaison du regard (rad ; inclinaison positive vers le bas). */
  cx: number;
  cy: number;
  cz: number;
  yaw: number;
  pitch: number;
  /** Rotation demandée par le doigt à cette image (rad). */
  dYaw: number;
  dPitch: number;
  /** Tireur : position et vitesse (m/s). */
  x: number;
  y: number;
  speed: number;
  /** Portée de l'arme (m). */
  range: number;
}

export class AimAssist {
  /** Rotation à appliquer (rad), après l'aide. */
  dYaw = 0;
  dPitch = 0;
  /** Emplacement de la cible aidée (−1 sans) et force de l'aide (0 au bord de la zone, 1 au centre). */
  target = -1;
  weight = 0;
  private readonly found: number[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly body = { z: 0, h: 0 };

  /** Un pas de `dt` s. Renvoie `this` (rotation dans `dYaw`, `dPitch`). */
  step(dt: number, level: AimAssistLevel, a: AimAssistInput, world: ShootWorld | null): this {
    this.dYaw = a.dYaw;
    this.dPitch = a.dPitch;
    this.target = -1;
    this.weight = 0;
    const def = AIM_ASSIST[level];
    if (!def || !world?.span || world.pick(a.x, a.y, a.yaw, a.range, SEARCH_ANGLE, SEARCH_MAX, this.found) === 0) return this;
    // La cible la plus proche du viseur (en angle, rapporté à la taille de sa zone), visible depuis le tireur.
    let best = Infinity, ey = 0, ep = 0;
    for (const slot of this.found) {
      world.position(slot, this.pos);
      world.span(slot, this.body);
      const tx = this.pos.x - a.cx, ty = this.pos.y - a.cy, tz = this.body.z + this.body.h * CHEST - a.cz;
      const d = Math.hypot(tx, ty);
      if (d < 1) continue;
      const zone = Math.min(Math.max(Math.atan2(def.radius, Math.hypot(d, tz)), def.minAngle), def.maxAngle);
      const errYaw = angleDelta(a.yaw, Math.atan2(tx, ty)), errPitch = Math.atan2(-tz, d) - a.pitch;
      // Écart d'angle à l'écran : le cap compte moins quand on regarde vers le haut ou le bas.
      const e = Math.hypot(errYaw * Math.cos(a.pitch), errPitch) / zone;
      if (e >= 1 || e >= best) continue;
      const wall = world.wall(a.x, a.y, this.pos.x, this.pos.y);
      if (wall !== null && wall < 0.98) continue;
      best = e;
      ey = errYaw;
      ep = errPitch;
      this.target = slot;
    }
    if (this.target < 0) return this;
    const w = 1 - best;
    this.weight = w;
    // Le viseur colle : le geste est freiné, d'autant plus qu'on est près du centre.
    const keep = 1 - def.friction * w;
    this.dYaw *= keep;
    this.dPitch *= keep;
    // Il est attiré, seulement si l'on tourne ou qu'on marche (jamais tout seul), sans jamais dépasser la cible.
    if (Math.abs(a.dYaw) + Math.abs(a.dPitch) > 1e-5 || a.speed > MOVING) {
      const k = Math.min(1, def.pull * w * dt);
      this.dYaw += (ey - this.dYaw) * k;
      this.dPitch += (ep - this.dPitch) * k;
    }
    return this;
  }
}

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
