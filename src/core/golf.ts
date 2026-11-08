import type { GolfSite } from "../data/types";

/** Golf municipal (D289, D290) : géométrie du practice, partagée par le rendu et les collisions (logique pure). */

/** Repère du practice : abscisse u le long de la ligne des tapis, v vers le terrain (à gauche de a → b). */
export function practiceFrame(p: NonNullable<GolfSite["practice"]>): { at: (u: number, v: number) => [number, number]; L: number; rot: number } {
  const [ax, ay] = p.a, [bx, by] = p.b;
  const L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L;
  return { at: (u, v) => [ax + tx * u - ty * v, ay + ty * u + tx * v], L, rot: Math.atan2(ty, tx) };
}

/** Points solides du practice (poteaux de l'abri, des cibles), pour les collisions. */
export function practicePosts(p: NonNullable<GolfSite["practice"]>): [number, number][] {
  const { at } = practiceFrame(p);
  const out: [number, number][] = [];
  const [s0, s1] = p.shelter;
  const n = Math.max(1, Math.round((s1 - s0) / 4));
  for (let k = 0; k <= n; k++) for (const v of [0.3, -p.depth - 2.2]) out.push(at(s0 + ((s1 - s0) * k) / n, v));
  return [...out, ...p.targets];
}

