/** Banc de test : calculs purs (statistiques d'images, parcours), testables sans navigateur. */

export interface FrameSummary {
  frames: number;
  seconds: number;
  /** Images par seconde moyennes. */
  fps: number;
  /** Images par seconde sur le 1 % des images les plus lentes. */
  low1: number;
  /** Durées d'image (ms) : médiane, 95e et 99e centiles, maximum. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Images de plus de 33 ms (sous 30 i/s) et de plus de 50 ms (à-coup visible). */
  over33: number;
  over50: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export function summarizeFrames(ms: readonly number[]): FrameSummary {
  const sorted = [...ms].sort((a, b) => a - b);
  let total = 0, over33 = 0, over50 = 0;
  for (const v of ms) {
    total += v;
    if (v > 33.4) over33++;
    if (v > 50) over50++;
  }
  // 1 % des images les plus lentes : moyenne de leurs durées, convertie en images par seconde.
  const n = Math.max(1, Math.ceil(sorted.length / 100));
  let slow = 0;
  for (let i = sorted.length - n; i < sorted.length; i++) slow += sorted[i] ?? 0;
  const slowMean = sorted.length ? slow / n : 0;
  return {
    frames: ms.length,
    seconds: total / 1000,
    fps: total > 0 ? (ms.length * 1000) / total : 0,
    low1: slowMean > 0 ? 1000 / slowMean : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1]! : 0,
    over33,
    over50,
  };
}

/** Ligne brisée parcourue à abscisse curviligne (mètres). */
export class Polyline {
  readonly length: number;
  private readonly cum: number[] = [0];

  constructor(private readonly pts: readonly number[]) {
    let s = 0;
    for (let i = 2; i < pts.length; i += 2) {
      s += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
      this.cum.push(s);
    }
    this.length = s;
  }

  /** Point à l'abscisse s, bornée aux extrémités. */
  at(s: number): { x: number; y: number } {
    const c = this.cum;
    if (s <= 0) return { x: this.pts[0]!, y: this.pts[1]! };
    if (s >= this.length) return { x: this.pts[this.pts.length - 2]!, y: this.pts[this.pts.length - 1]! };
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - c[lo]!) / (c[hi]! - c[lo]! || 1);
    const ax = this.pts[2 * lo]!, ay = this.pts[2 * lo + 1]!;
    return { x: ax + (this.pts[2 * hi]! - ax) * t, y: ay + (this.pts[2 * hi + 1]! - ay) * t };
  }
}

/** Endurance : évolution des images par seconde minute après minute (la chauffe fait baisser la fréquence du processeur et du GPU). */
export function soakTrend(fps: readonly number[]): { first: number; last: number; min: number; drop: number } | null {
  if (fps.length === 0) return null;
  const first = fps[0]!, last = fps[fps.length - 1]!;
  return { first, last, min: Math.min(...fps), drop: first - last };
}
