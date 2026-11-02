/**
 * Indicateur de la direction d'un tir reçu (T4, D208). Logique pure.
 *
 * Analogie : la boussole d'un orage. Chaque balle tirée vers le joueur laisse au bord de l'écran un arc tourné vers le tireur, vif si elle a porté,
 * pâle si elle a manqué, qui s'éteint en `THREAT_LIFE` s. Plusieurs tirs venant de la même direction ravivent le même arc.
 */

/** Durée de vie d'un arc (s), arcs au plus, écart d'angle (rad) en dessous duquel deux tirs partagent un arc. */
export const THREAT_LIFE = 1.6;
export const THREAT_MAX = 4;
const MERGE = 0.35;
/** Force d'un tir qui manque (un tir qui porte : 1). */
const MISS = 0.55;

export interface Threat {
  /** Cap du tireur vu du joueur (rad, 0 au nord, sens horaire), âge (s) et force (0 à 1). */
  bearing: number;
  age: number;
  strength: number;
}

export class Threats {
  readonly list: Threat[] = [];

  /** Un tir parti de (sx, sy) vers le joueur en (px, py) ; `hit` : il a porté. */
  add(sx: number, sy: number, px: number, py: number, hit: boolean): void {
    if (Math.hypot(sx - px, sy - py) < 0.5) return;
    const bearing = Math.atan2(sx - px, sy - py), strength = hit ? 1 : MISS;
    for (const t of this.list) {
      if (Math.abs(delta(t.bearing, bearing)) < MERGE) {
        t.strength = Math.max(strength, Threats.alpha(t));
        t.bearing = bearing;
        t.age = 0;
        return;
      }
    }
    if (this.list.length >= THREAT_MAX) {
      // Plus de place : le plus vieux cède la sienne.
      let old = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i]!.age > this.list[old]!.age) old = i;
      this.list.splice(old, 1);
    }
    this.list.push({ bearing, age: 0, strength });
  }

  step(dt: number): void {
    for (const t of this.list) t.age += dt;
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.age >= THREAT_LIFE) this.list.splice(i, 1);
  }

  /** Opacité d'un arc : sa force, qui s'éteint sur sa durée de vie (plus vite à la fin). */
  static alpha(t: Threat): number {
    const u = Math.min(1, t.age / THREAT_LIFE);
    return t.strength * (1 - u * u);
  }

  /** Angle à l'écran (rad, 0 en haut, sens horaire) d'un arc pour une caméra qui regarde au cap `yaw`. */
  static screenAngle(t: Threat, yaw: number): number {
    return delta(yaw, t.bearing);
  }

  clear(): void {
    this.list.length = 0;
  }
}

function delta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
