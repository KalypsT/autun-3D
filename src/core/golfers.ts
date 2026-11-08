import type { GolfSite } from "../data/types";
import { practiceFrame } from "./golf";

/**
 * Golfeurs du golf municipal (D291) : logique pure. Des groupes de deux à quatre joueurs enchaînent les trous du parcours (`holes` du site,
 * dans l'ordre de jeu) : du départ, ils marchent vers le green en s'arrêtant à chaque coup, se rassemblent autour du drapeau, puis vont au
 * départ suivant. Au practice, quelques joueurs se tiennent sur les tapis, face au terrain.
 *
 * Analogie : des pions qu'on avance sur un plateau de jeu de l'oie ; les cases sont les coups, la fin d'un tour mène au trou suivant.
 */

export const GOLF_WALK = 1.05; // m/s, en poussant un chariot
const SHOT_EVERY = 70; // m entre deux coups sur le fairway
const SHOT_STOP = 9; // s d'arrêt à chaque coup
const TEE_STOP = 14;
const GREEN_STOP = 30;
const SPACING = 1.9; // m entre deux joueurs côte à côte

/** Un golfeur à afficher : position (repère des données), cap de marche (rad, 0 = nord, sens horaire), vitesse, chariot. */
export interface Golfer {
  x: number;
  y: number;
  heading: number;
  speed: number;
  trolley: boolean;
}

interface Group {
  size: number;
  hole: number;
  /** Étapes du trou : points (x, y) et arrêt (s) une fois arrivés. */
  legs: { x: number; y: number; stop: number }[];
  leg: number;
  x: number;
  y: number;
  heading: number;
  wait: number;
  /** Position de chaque joueur autour du drapeau (angle), pour ne pas se tenir en ligne sur le green. */
  ring: number;
}

function legsOf(h: readonly number[]): { x: number; y: number; stop: number }[] {
  const [tx, ty, gx, gy, fx, fy] = h as [number, number, number, number, number, number];
  const L = Math.hypot(gx - tx, gy - ty);
  const out = [{ x: tx, y: ty, stop: TEE_STOP }];
  const n = Math.max(0, Math.floor((L - 25) / SHOT_EVERY));
  for (let k = 1; k <= n; k++) out.push({ x: tx + ((gx - tx) * k * SHOT_EVERY) / L, y: ty + ((gy - ty) * k * SHOT_EVERY) / L, stop: SHOT_STOP });
  // Au bord du green, puis autour du drapeau.
  out.push({ x: gx + ((tx - gx) * 9) / (L || 1), y: gy + ((ty - gy) * 9) / (L || 1), stop: SHOT_STOP });
  out.push({ x: fx, y: fy, stop: GREEN_STOP });
  return out;
}

export class GolfRound {
  private readonly groups: Group[] = [];
  private readonly practice: Golfer[] = [];

  constructor(private readonly site: GolfSite, groups = 4, seed = 1) {
    const holes = site.holes ?? [];
    for (let g = 0; g < groups && holes.length; g++) {
      const hole = Math.floor((g * holes.length) / groups);
      const legs = legsOf(holes[hole]!);
      const leg = (g * 3 + seed) % legs.length;
      this.groups.push({ size: 2 + ((g * 7 + seed) % 3), hole, legs, leg, x: legs[leg]!.x, y: legs[leg]!.y, heading: 0, wait: (g * 5) % 11, ring: g * 1.3 });
    }
    if (site.practice) {
      const { at, L, rot } = practiceFrame(site.practice);
      // Face au terrain, à gauche de la ligne des tapis : direction (−sin rot, cos rot), cap boussole atan2(est, nord).
      const heading = Math.atan2(-Math.sin(rot), Math.cos(rot));
      for (const u of [L - 7.5, L - 13.5, L - 22.5]) {
        const [x, y] = at(u, -0.95);
        this.practice.push({ x, y, heading, speed: 0, trolley: false });
      }
    }
  }

  get capacity(): number {
    return this.groups.length * 4 + this.practice.length;
  }

  /** Fait avancer les groupes de `dt` secondes. */
  step(dt: number): void {
    const holes = this.site.holes ?? [];
    for (const g of this.groups) {
      if (g.wait > 0) {
        g.wait -= dt;
        continue;
      }
      const target = g.legs[g.leg]!;
      const dx = target.x - g.x, dy = target.y - g.y, d = Math.hypot(dx, dy);
      const step = GOLF_WALK * dt;
      if (d > 0.05) g.heading = Math.atan2(dx, dy);
      if (d <= step) {
        g.x = target.x;
        g.y = target.y;
        g.wait = target.stop;
        g.leg++;
        if (g.leg >= g.legs.length) {
          g.hole = (g.hole + 1) % holes.length;
          g.legs = legsOf(holes[g.hole]!);
          g.leg = 0;
        }
      } else {
        g.x += (dx / d) * step;
        g.y += (dy / d) * step;
      }
    }
  }

  /** Les golfeurs à afficher (groupes, puis practice), écrits dans `out` ; rend leur nombre. */
  golfers(out: Golfer[]): number {
    let n = 0;
    for (const g of this.groups) {
      const walking = g.wait <= 0;
      const onGreen = !walking && g.leg > 0 && g.legs[g.leg - 1]!.stop === GREEN_STOP;
      for (let k = 0; k < g.size; k++) {
        const o = (out[n] ??= { x: 0, y: 0, heading: 0, speed: 0, trolley: true });
        if (onGreen) {
          // Autour du drapeau, à 3 à 5 m, tournés vers lui ; les chariots restent au bord du green.
          const a = g.ring + (k * 2 * Math.PI) / g.size, r = 3 + (k % 2) * 1.8;
          o.x = g.x + Math.sin(a) * r;
          o.y = g.y + Math.cos(a) * r;
          o.heading = a + Math.PI;
          o.trolley = false;
        } else {
          // Côte à côte, perpendiculairement à la marche.
          const side = (k - (g.size - 1) / 2) * SPACING;
          o.x = g.x + Math.cos(g.heading) * side;
          o.y = g.y - Math.sin(g.heading) * side;
          o.heading = g.heading;
          o.trolley = true;
        }
        o.speed = walking ? GOLF_WALK : 0;
        n++;
      }
    }
    for (const p of this.practice) out[n++] = { ...p };
    return n;
  }
}
