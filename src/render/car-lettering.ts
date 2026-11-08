import type * as THREE from "three";
import type { Guide, SculptKit } from "./car-sculpt";

/**
 * Lettrage des voitures de gendarmerie (D281, D282) : le mot GENDARMERIE tracé en traits posés sur la caisse (pas de texture, style « affiche »).
 */

/**
 * Police à bâtons des lettres du mot GENDARMERIE : traits (suites de points) dans une case de 0,6 de large sur 1 de haut ; la largeur de chaque lettre
 * (avance) en plus.
 */
const GLYPHS: Readonly<Record<string, { w: number; strokes: readonly (readonly (readonly [number, number])[])[] }>> = {
  G: { w: 0.6, strokes: [[[0.6, 1], [0.08, 1], [0, 0.9], [0, 0], [0.6, 0], [0.6, 0.45], [0.32, 0.45]]] },
  E: { w: 0.55, strokes: [[[0.55, 1], [0, 1], [0, 0], [0.55, 0]], [[0, 0.5], [0.42, 0.5]]] },
  N: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]] },
  D: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.35, 1], [0.6, 0.75], [0.6, 0.25], [0.35, 0], [0, 0]]] },
  A: { w: 0.6, strokes: [[[0, 0], [0.3, 1], [0.6, 0]], [[0.12, 0.38], [0.48, 0.38]]] },
  R: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.5, 1], [0.6, 0.9], [0.6, 0.5], [0, 0.5]], [[0.3, 0.5], [0.6, 0]]] },
  M: { w: 0.7, strokes: [[[0, 0], [0, 1], [0.35, 0.45], [0.7, 1], [0.7, 0]]] },
  I: { w: 0.1, strokes: [[[0.05, 0], [0.05, 1]]] },
};

/**
 * Mot écrit en traits posés sur la caisse, à l'endroit pour qui le regarde : `place(u, v)` donne le point du dessin (u le long du mot, v vers le haut,
 * en m) ; `h` hauteur des lettres, `stroke` épaisseur des traits.
 */
export function lettering(k: SculptKit, word: string, h: number, stroke: number, color: string, lift: number, place: (u: number, v: number) => Guide): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  let u0 = 0;
  for (const ch of word) {
    const glyph = GLYPHS[ch]!;
    for (const line of glyph.strokes) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, ay] = line[i]!, [bx, by] = line[i + 1]!;
        const au = u0 + ax * h, av = ay * h, bu = u0 + bx * h, bv = by * h;
        const len = Math.hypot(bu - au, bv - av) || 1, nu = (-(bv - av) / len) * (stroke / 2), nv = ((bu - au) / len) * (stroke / 2);
        // Les traits débordent un peu à leurs bouts, pour que les coins se rejoignent.
        const eu = ((bu - au) / len) * (stroke / 2), ev = ((bv - av) / len) * (stroke / 2);
        out.push(k.decal([
          [place(au - eu + nu, av - ev + nv), place(bu + eu + nu, bv + ev + nv)],
          [place(au - eu - nu, av - ev - nv), place(bu + eu - nu, bv + ev - nv)],
        ], color, lift, false));
      }
    }
    u0 += (glyph.w + 0.28) * h;
  }
  return out;
}

/** Longueur d'un mot écrit avec `lettering` (m). */
export function wordLength(word: string, h: number): number {
  return [...word].reduce((sum, ch) => sum + (GLYPHS[ch]!.w + 0.28) * h, -0.28 * h);
}

