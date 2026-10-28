import type { Deck } from "../data/types";

/** Point de l'axe d'un tablier à l'abscisse `s` : position, altitude, tangente unitaire. */
export interface AxisPoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
}

/** Axe d'un tablier avec ses abscisses cumulées. */
export class DeckAxis {
  readonly cum: number[] = [0];
  readonly length: number;

  constructor(readonly deck: Deck) {
    const p = deck.p;
    for (let i = 3; i < p.length; i += 3) this.cum.push(this.cum[this.cum.length - 1]! + Math.hypot(p[i]! - p[i - 3]!, p[i + 1]! - p[i - 2]!));
    this.length = this.cum[this.cum.length - 1]!;
  }

  at(s: number): AxisPoint {
    const p = this.deck.p;
    const ss = Math.min(Math.max(s, 0), this.length);
    let j = 1;
    while (j < this.cum.length - 1 && this.cum[j]! < ss) j++;
    const s0 = this.cum[j - 1]!, s1 = this.cum[j]!;
    const t = s1 > s0 ? (ss - s0) / (s1 - s0) : 0;
    const ax = p[3 * (j - 1)]!, ay = p[3 * (j - 1) + 1]!, az = p[3 * (j - 1) + 2]!, bx = p[3 * j]!, by = p[3 * j + 1]!, bz = p[3 * j + 2]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, ty: (by - ay) / len };
  }
}

/** Lignes des deux parapets d'un tablier (bords gauche et droit), sur chaque tronçon infranchissable, un point tous les 2 m. */
export function parapetLines(d: Deck): number[][] {
  const axis = new DeckAxis(d);
  const out: number[][] = [];
  const hw = d.w / 2;
  for (const [s0, s1] of d.pc) {
    if (s1 - s0 < 0.5) continue;
    for (const side of [1, -1]) {
      const line: number[] = [];
      const n = Math.max(1, Math.ceil((s1 - s0) / 2));
      for (let k = 0; k <= n; k++) {
        const a = axis.at(s0 + ((s1 - s0) * k) / n);
        line.push(a.x + a.ty * hw * side, a.y - a.tx * hw * side);
      }
      out.push(line);
    }
  }
  return out;
}
