import { findGuide, pedGuide } from "../guide";
import type { NavGraph } from "../nav-graph";
import type { RoadGraph } from "../road-graph";
import { ORDER } from "../pedestrians";
import type { EventPeds } from "./types";

/**
 * Un passant réquisitionné qui va quelque part à pied en contournant les murs (phase 4 : les pompiers vers le malade, les gendarmes vers les
 * bagarreurs) : itinéraire sur le graphe piéton (le plus court chemin du guidage de D310), suivi de point en point par l'ordre « aller à ».
 * Sans graphe ou sans itinéraire, il va tout droit. Analogie : le trait du GPS, que l'on suit de borne en borne.
 */

const at = { x: 0, y: 0 };

/** Longueur (m) du trajet à pied de (ax, ay) à (bx, by) sur le graphe piéton ; la ligne droite sans graphe ; Infinity sans chemin. */
export function walkLength(nav: NavGraph | null, ax: number, ay: number, bx: number, by: number): number {
  const straight = Math.hypot(bx - ax, by - ay);
  if (!nav || straight < 6) return straight;
  const from = nav.nearest(ax, ay, 20), to = nav.nearest(bx, by, 20);
  if (!from || !to) return Infinity;
  const r = findGuide(pedGuide(nav), from, to, { maxExpand: 4000 });
  return r ? r.length + from.dist + to.dist : Infinity;
}

/**
 * Où un véhicule de secours ou de police se gare pour une scène en (x, y) : la chaussée carrossable la plus proche d'où l'on va jusqu'à la scène
 * en ligne droite (pas de mur entre elles, si `lineClear` est donné), sinon la plus proche tout court ; au bord, du côté de la scène. La scène
 * elle-même sans route à 80 m.
 */
export function roadside(road: RoadGraph | null, x: number, y: number, lineClear?: (x0: number, y0: number, x1: number, y1: number) => boolean): { x: number; y: number; vx: number; vy: number } {
  let best = null as { x: number; y: number } | null, bestD = Infinity;
  // D'abord une chaussée en vue de la scène ; à défaut (rue piétonne, place), la chaussée la plus proche : on finit à pied par le graphe piéton.
  for (const clear of lineClear ? [lineClear, null] : [null]) {
    for (const r of [0, 12, 24, 36, 48, 60]) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = (k * Math.PI) / 4, hit = road?.nearest(x + Math.sin(a) * r, y + Math.cos(a) * r, 20);
        if (!hit || !road!.drivable(hit.edge)) continue;
        const d = Math.hypot(hit.x - x, hit.y - y);
        if (d >= bestD || (clear && !clear(hit.x, hit.y, x, y))) continue;
        best = { x: hit.x, y: hit.y };
        bestD = d;
      }
    }
    if (best) break;
  }
  const hx = best ? best.x : x, hy = best ? best.y : y, d = Math.hypot(x - hx, y - hy) || 1;
  const k = Math.min(1.6, d) / d;
  return { x: hx + (x - hx) * k, y: hy + (y - hy) * k, vx: 0, vy: 0 };
}

export class Walker {
  /** Points à suivre (x0, y0, x1, y1…), le dernier est le but. */
  private pts: number[] = [];
  private k = 0;
  /** Depuis combien de secondes il n'avance plus (un muret, un grillage qu'il ne sait pas contourner). */
  stuckT = 0;
  private lastX = NaN;
  private lastY = NaN;

  constructor(
    private readonly peds: EventPeds,
    readonly slot: number,
  ) {}

  /** Trace l'itinéraire de sa position jusqu'à (x, y) sur le graphe piéton (ligne droite sans graphe ou sans chemin). */
  plan(nav: NavGraph | null, x: number, y: number): void {
    this.peds.position(this.slot, at);
    this.pts = [at.x, at.y];
    this.k = 0;
    const from = nav?.nearest(at.x, at.y, 20), to = nav?.nearest(x, y, 20);
    // Un détour sur le graphe ne vaut que si la ligne droite est bouchée : de près, on y va tout droit.
    if (nav && from && to && Math.hypot(x - at.x, y - at.y) > 6) {
      const r = findGuide(pedGuide(nav), from, to, { maxExpand: 4000 });
      if (r) this.pts.push(...r.points);
    }
    this.pts.push(x, y);
  }

  /** Un pas : vers le point suivant de l'itinéraire, à `speed` m/s ; vrai une fois à moins de `reach` m du but. */
  step(speed: number, reach: number, dt = 1 / 60): boolean {
    const n = this.pts.length / 2;
    if (n === 0) return true;
    this.peds.position(this.slot, at);
    if (Math.hypot(at.x - this.lastX, at.y - this.lastY) > 0.5) {
      this.lastX = at.x;
      this.lastY = at.y;
      this.stuckT = 0;
    } else this.stuckT += dt;
    const gx = this.pts[(n - 1) * 2]!, gy = this.pts[(n - 1) * 2 + 1]!;
    if (Math.hypot(gx - at.x, gy - at.y) < reach) return true;
    // On passe au point suivant à moins d'un mètre (ou quand le suivant est déjà plus près que celui-ci).
    while (this.k < n - 1) {
      const x = this.pts[this.k * 2]!, y = this.pts[this.k * 2 + 1]!, nx = this.pts[this.k * 2 + 2]!, ny = this.pts[this.k * 2 + 3]!;
      if (Math.hypot(x - at.x, y - at.y) < 1 || Math.hypot(nx - at.x, ny - at.y) < Math.hypot(nx - x, ny - y)) this.k++;
      else break;
    }
    this.peds.command(this.slot, ORDER.seek, this.pts[this.k * 2]!, this.pts[this.k * 2 + 1]!, speed);
    return false;
  }
}
