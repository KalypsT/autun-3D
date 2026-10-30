/**
 * Circuit du petit train touristique (D117) : logique pure. Les sommets viennent des rues du jeu (`train-route-data.ts`, généré) ; ici, le tracé
 * est décalé sur la voie de droite, arrondi aux carrefours, puis rééchantillonné tous les mètres : une position, un cap et une vitesse permise
 * pour chaque mètre de la boucle. Analogie : le rail invisible d'un manège, posé une fois pour toutes sur la chaussée.
 */

import { TRAIN_ROUTE_MONUMENTS, TRAIN_ROUTE_POINTS, TRAIN_ROUTE_SIGNALS } from "./train-route-data";

export const ROUTE = {
  /** Pas du rééchantillonnage final (m). */
  step: 1,
  /** Pas avant arrondi des virages (m) : plus il est court, plus les virages sont serrés. */
  coarse: 6,
  /** Vitesses (m/s) : en ligne, le long d'un monument, dans un virage serré. */
  cruise: 12 / 3.6,
  monument: 6 / 3.6,
  /** Accélération latérale tolérée dans les virages (m/s²) : des passagers assis, sans ceinture. */
  lateral: 0.9,
  /** Distance (m) jusqu'à laquelle un monument fait ralentir le train. */
  monumentReach: 40,
  /** Décélération prévue pour arriver au ralenti à l'endroit voulu (m/s²). */
  brake: 0.6,
  /**
   * Arrêt du départ (m après le premier sommet, le coin de la rue du Général Demetz) : la locomotive s'arrête assez loin pour que tout le
   * train attende dans la rue, sa queue au coin (plus que la longueur du train : un essai le vérifie).
   */
  depot: 22,
} as const;

export interface RoutePoint {
  x: number;
  y: number;
  /** Cap (rad, 0 = nord, sens horaire). */
  heading: number;
}

export class TrainRoute {
  /** Longueur de la boucle (m) et points tous les `ROUTE.step` m. */
  readonly length: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  /** Vitesse permise à chaque point (m/s), freinage anticipé compris. */
  readonly limit: Float64Array;
  /** Abscisses (m) des nœuds à feux, dans l'ordre de la boucle. */
  readonly signals: { s: number; x: number; y: number }[];

  constructor(points: readonly number[] = TRAIN_ROUTE_POINTS, signals: readonly number[] = TRAIN_ROUTE_SIGNALS, monuments = TRAIN_ROUTE_MONUMENTS) {
    const raw: [number, number][] = offsetLoop(points);
    let loop = chaikin(resample(raw, ROUTE.coarse), 3);
    loop = resample(loop, ROUTE.step);
    // L'abscisse 0 est l'arrêt du départ.
    const k = Math.round(ROUTE.depot / ROUTE.step) % loop.length;
    loop = [...loop.slice(k), ...loop.slice(0, k)];
    const n = loop.length;
    this.xs = Float64Array.from(loop, (p) => p[0]);
    this.ys = Float64Array.from(loop, (p) => p[1]);
    this.length = n * ROUTE.step;
    this.limit = new Float64Array(n);
    this.signals = [];
    for (let i = 0; i < signals.length; i += 2) this.signals.push({ s: this.nearestS(signals[i]!, signals[i + 1]!), x: signals[i]!, y: signals[i + 1]! });
    this.signals.sort((a, b) => a.s - b.s);
    this.speedProfile(monuments);
  }

  /** Point de la boucle à l'abscisse `s` (m, ramenée dans la boucle). */
  at(s: number, out: RoutePoint): RoutePoint {
    const n = this.xs.length, f = this.wrap(s) / ROUTE.step, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
    const ax = this.xs[i]!, ay = this.ys[i]!, bx = this.xs[j]!, by = this.ys[j]!;
    out.x = ax + (bx - ax) * t;
    out.y = ay + (by - ay) * t;
    out.heading = Math.atan2(bx - ax, by - ay);
    return out;
  }

  /** Vitesse permise (m/s) à l'abscisse `s`. */
  speedAt(s: number): number {
    return this.limit[Math.floor(this.wrap(s) / ROUTE.step) % this.limit.length]!;
  }

  /** Tous les points de la boucle (x, y à la suite), un par mètre. */
  samples(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.xs.length; i++) out.push(this.xs[i]!, this.ys[i]!);
    return out;
  }

  /** Abscisse du point de la boucle le plus proche de (x, y). */
  nearestS(x: number, y: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      const d = (this.xs[i]! - x) ** 2 + (this.ys[i]! - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best * ROUTE.step;
  }

  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Vitesse permise : en ligne, ralentie le long des monuments et dans les virages, puis freinage anticipé (deux tours pour la boucle). */
  private speedProfile(monuments: readonly { x: number; y: number }[]): void {
    const n = this.xs.length, lim = this.limit, look = 6;
    for (let i = 0; i < n; i++) {
      // Courbure : changement de cap sur ±6 m.
      const a = (i - look + n) % n, b = (i + look) % n;
      const h0 = Math.atan2(this.xs[i]! - this.xs[a]!, this.ys[i]! - this.ys[a]!), h1 = Math.atan2(this.xs[b]! - this.xs[i]!, this.ys[b]! - this.ys[i]!);
      const turn = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
      const radius = turn > 1e-3 ? (look * ROUTE.step) / turn : Infinity;
      let v = Math.min(ROUTE.cruise, Math.sqrt(ROUTE.lateral * radius));
      for (const m of monuments) if (Math.hypot(this.xs[i]! - m.x, this.ys[i]! - m.y) < ROUTE.monumentReach) v = Math.min(v, ROUTE.monument);
      lim[i] = Math.max(v, 1);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 2 * n - 1; k >= 0; k--) {
        const i = k % n, j = (i + 1) % n;
        lim[i] = Math.min(lim[i]!, Math.sqrt(lim[j]! ** 2 + 2 * ROUTE.brake * ROUTE.step));
      }
    }
  }
}

/** Sommets décalés vers la droite (milieu de la voie) : normale moyenne des deux segments voisins, bornée dans les angles serrés. */
function offsetLoop(flat: readonly number[]): [number, number][] {
  const n = flat.length / 3, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const x = flat[i * 3]!, y = flat[i * 3 + 1]!, o = flat[i * 3 + 2]!;
    const d0 = norm(x - flat[p * 3]!, y - flat[p * 3 + 1]!), d1 = norm(flat[q * 3]! - x, flat[q * 3 + 1]! - y);
    // Droite d'une direction (dx, dy) : (dy, −dx).
    const rx = (d0[1] + d1[1]) / 2, ry = -(d0[0] + d1[0]) / 2, len = Math.hypot(rx, ry);
    const k = len > 0.3 ? o / len : o;
    out.push([x + rx * (len > 0.3 ? k : 0), y + ry * (len > 0.3 ? k : 0)]);
  }
  return out;
}

function norm(dx: number, dy: number): [number, number] {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Boucle rééchantillonnée à pas constant (le dernier pas se referme sur le premier point). */
function resample(loop: readonly [number, number][], step: number): [number, number][] {
  const n = loop.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.hypot(loop[(i + 1) % n]![0] - loop[i]![0], loop[(i + 1) % n]![1] - loop[i]![1]);
  const count = Math.max(3, Math.round(total / step)), d = total / count, out: [number, number][] = [];
  let i = 0, acc = 0, segLen = Math.hypot(loop[1 % n]![0] - loop[0]![0], loop[1 % n]![1] - loop[0]![1]);
  for (let k = 0; k < count; k++) {
    const target = k * d;
    while (acc + segLen < target && i < n - 1) {
      acc += segLen;
      i++;
      segLen = Math.hypot(loop[(i + 1) % n]![0] - loop[i]![0], loop[(i + 1) % n]![1] - loop[i]![1]);
    }
    const t = segLen > 0 ? (target - acc) / segLen : 0, a = loop[i]!, b = loop[(i + 1) % n]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Arrondi des angles (Chaikin), sur une boucle. */
function chaikin(loop: [number, number][], iterations: number): [number, number][] {
  let cur = loop;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [], n = cur.length;
    for (let i = 0; i < n; i++) {
      const a = cur[i]!, b = cur[(i + 1) % n]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}
