import type { SailRoute } from "../data/types";

/**
 * Voiliers du plan d'eau du Vallon (D249, choix de l'utilisateur : des voiliers sur l'eau en été) : des dériveurs suivent les boucles
 * `sail` des ouvrages (build_vallon_life.py, vérifiées dans l'eau navigable). Logique pure et déterministe : la position de chaque voilier
 * ne dépend que du temps de jeu, sans simulation ni collision (un nageur passe à travers).
 */

/** Allure le long de la boucle (m/s) et gîte (rad). */
export const SAIL_SPEED = 1.6;
export const SAIL_HEEL = 0.14;

/** Places : boucle (indice, modulo le nombre de boucles), avance de départ (part de la boucle), sens, couleur de coque. */
const SLOTS: readonly { r: number; off: number; dir: 1 | -1; c: string }[] = [
  { r: 0, off: 0, dir: 1, c: "#f2f2ee" },
  { r: 1, off: 0.3, dir: -1, c: "#e8c547" },
  { r: 2, off: 0.6, dir: 1, c: "#f2f2ee" },
  { r: 0, off: 0.5, dir: 1, c: "#d9472b" },
  { r: 0, off: 0.25, dir: -1, c: "#3f78c9" },
];
export const SAIL_SLOTS = SLOTS.length;
/** Couleur de coque de chaque place. */
export const SAIL_HULLS: readonly string[] = SLOTS.map((s) => s.c);

/**
 * Nombre de voiliers sur l'eau : l'été (saison 1) de 10 h à 19 h, trois en semaine et cinq le week-end ; au printemps et en automne,
 * deux le week-end de 13 h à 18 h ; jamais l'hiver ni la nuit. `weekday` : 0 = lundi.
 */
export function sailCount(season: number, hour: number, weekday: number): number {
  const weekend = weekday >= 5;
  if (season === 1) return hour >= 10 && hour < 19 ? (weekend ? 5 : 3) : 0;
  if (season === 0 || season === 2) return weekend && hour >= 13 && hour < 18 ? 2 : 0;
  return 0;
}

export interface SailPose {
  x: number;
  y: number;
  z: number;
  /** Cap (rad, depuis l'est, sens trigonométrique), gîte, couleur de coque. */
  a: number;
  heel: number;
  c: string;
}

/** Point d'une boucle fermée à l'abscisse `s` (m, modulo la longueur), et sa direction. */
export function routeAt(p: readonly number[], s: number): { x: number; y: number; tx: number; ty: number; length: number } {
  const n = p.length / 2;
  let L = 0;
  for (let i = 0; i < n; i++) L += Math.hypot(p[((i + 1) % n) * 2]! - p[i * 2]!, p[((i + 1) % n) * 2 + 1]! - p[i * 2 + 1]!);
  let d = ((s % L) + L) % L;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2]!, ay = p[i * 2 + 1]!, bx = p[((i + 1) % n) * 2]!, by = p[((i + 1) % n) * 2 + 1]!;
    const l = Math.hypot(bx - ax, by - ay);
    if (d <= l || i === n - 1) {
      const t = l > 0 ? Math.min(1, d / l) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, tx: (bx - ax) / (l || 1), ty: (by - ay) / (l || 1), length: L };
    }
    d -= l;
  }
  return { x: p[0]!, y: p[1]!, tx: 1, ty: 0, length: L };
}

/** Voiliers sur l'eau à l'instant `t` (s de jeu). */
export function sailPoses(routes: readonly SailRoute[], t: number, season: number, hour: number, weekday: number): SailPose[] {
  if (!routes.length) return [];
  const n = sailCount(season, hour, weekday);
  const out: SailPose[] = [];
  for (let k = 0; k < Math.min(n, SLOTS.length); k++) {
    const slot = SLOTS[k]!;
    const r = routes[slot.r % routes.length]!;
    const L = routeAt(r.p, 0).length;
    const q = routeAt(r.p, slot.dir * SAIL_SPEED * t + slot.off * L);
    const a = Math.atan2(q.ty * slot.dir, q.tx * slot.dir);
    // Gîte : un peu de houle, d'un voilier à l'autre.
    const heel = SAIL_HEEL * (0.8 + 0.2 * Math.sin(t * 0.7 + k * 1.9));
    out.push({ x: q.x, y: q.y, z: r.z, a, heel, c: slot.c });
  }
  return out;
}
