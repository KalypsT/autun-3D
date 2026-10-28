import type { Colliders } from "./collision";
import type { RoadGraph } from "./road-graph";
import type { WantedView } from "./wanted";

/**
 * Police (J4, D74) : ce qu'elle voit, combien de voitures elle envoie, où elle cherche quand elle a perdu la piste. Logique pure ; le jeu (`src/game/police.ts`)
 * relie le niveau de recherche, la circulation et les infractions.
 */

/** Voitures en poursuite selon le niveau de recherche (0 à 3 étoiles). */
export const PURSUERS = [0, 1, 2, 4] as const;

/** Une voiture de police (ou, en J4-5, un gendarme à pied) : position, cap, en poursuite ou non. */
export interface PoliceUnit {
  x: number;
  y: number;
  heading: number;
  chasing: boolean;
}

/**
 * Portée de la vue : en poursuite on cherche partout autour de soi (90 m) ; en patrouille, devant soi (±70°, 55 m) ou tout près (15 m).
 * Les murs (segments des obstacles) cachent ; le mobilier et les voitures, non.
 */
export const SIGHT = { chase: 90, patrol: 55, near: 15, halfAngle: 1.2 } as const;

/** Un des policiers voit-il le point (x, y) ? */
export function policeSees(units: readonly PoliceUnit[], x: number, y: number, colliders: Colliders | null): boolean {
  for (const u of units) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy);
    if (d > (u.chasing ? SIGHT.chase : SIGHT.patrol)) continue;
    if (!u.chasing && d > SIGHT.near) {
      const off = Math.atan2(Math.sin(Math.atan2(dx, dy) - u.heading), Math.cos(Math.atan2(dx, dy) - u.heading));
      if (Math.abs(off) > SIGHT.halfAngle) continue;
    }
    if (d < 1 || (colliders?.raycast(u.x, u.y, x, y) ?? null) === null) return true;
  }
  return false;
}

/** Un nouveau point de fouille dès qu'une voiture est à moins de … m du point actuel, ou au bout de … s. */
const SEARCH_REACHED = 14;
const SEARCH_EVERY = 20;

/**
 * Où vont les voitures en poursuite : sur le joueur tant qu'on le voit ; sinon à sa dernière position connue, puis de point en point au hasard
 * dans la zone de recherche (sur une route), comme une patrouille qui quadrille le quartier.
 */
export class Search {
  x = 0;
  y = 0;
  /** Points de fouille tirés (diagnostic). */
  points = 0;
  private timer = 0;
  private lastSeen = true;
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * Met à jour le point visé : `seen` le joueur est vu (le point est sur lui), sinon la fouille autour de `wanted.lastX/lastY`.
   * `units` : les voitures en poursuite ; `road` : pour poser les points sur une route.
   */
  update(dt: number, wanted: WantedView, playerX: number, playerY: number, units: readonly PoliceUnit[], road: RoadGraph | null): void {
    if (wanted.seen) {
      this.x = playerX;
      this.y = playerY;
      this.lastSeen = true;
      return;
    }
    if (this.lastSeen) {
      // On vient de le perdre : d'abord là où on l'a vu.
      this.lastSeen = false;
      this.x = wanted.lastX;
      this.y = wanted.lastY;
      this.timer = 0;
      return;
    }
    this.timer += dt;
    let reached = false;
    for (const u of units) if (u.chasing && Math.hypot(u.x - this.x, u.y - this.y) < SEARCH_REACHED) reached = true;
    if (!reached && this.timer < SEARCH_EVERY) return;
    this.timer = 0;
    const r = Math.max(wanted.radius, 40);
    for (let k = 0; k < 6; k++) {
      const a = this.random() * Math.PI * 2, d = r * Math.sqrt(this.random());
      const px = wanted.lastX + Math.sin(a) * d, py = wanted.lastY + Math.cos(a) * d;
      const hit = road?.nearest(px, py, 40);
      if (road && !hit) continue;
      this.x = hit ? hit.x : px;
      this.y = hit ? hit.y : py;
      this.points++;
      return;
    }
  }
}

/** Refus de s'arrêter : vu par une voiture en poursuite à moins de … m, en roulant à plus de … m/s, pendant … s cumulées (une étoile devient deux). */
const EVADE_RANGE = 35;
const EVADE_SPEED = 4;
const EVADE_AFTER = 6;

export class EvadeWatch {
  private time = 0;

  /** Vrai une fois quand le refus de s'arrêter est constaté (à une étoile seulement). */
  update(dt: number, stars: number, seen: boolean, playerX: number, playerY: number, speed: number, units: readonly PoliceUnit[]): boolean {
    if (stars !== 1) {
      this.time = 0;
      return false;
    }
    let close = false;
    for (const u of units) if (u.chasing && Math.hypot(u.x - playerX, u.y - playerY) < EVADE_RANGE) close = true;
    if (seen && close && speed > EVADE_SPEED) this.time += dt;
    if (this.time < EVADE_AFTER) return false;
    this.time = 0;
    return true;
  }
}
