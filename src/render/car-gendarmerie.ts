import * as THREE from "three";
import { DOWN, FRONT, REAR, SIDE, frontTurn, rearTurn, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { box, tube } from "./vehicle-model";

/**
 * Gendarmerie (D281) sculptée d'après les photos fournies par l'utilisateur : un SUV français à sept places, première version (2017-2020 : trois-quarts
 * avant et arrière ; la silhouette d'après le profil d'une miniature de la version suivante, inchangée) ; mesures 4,64 × 1,84 m, 1,65 m de caisse
 * (1,77 m rampe comprise), empattement de la fiche gardé (2,64 m : le vrai fait 2,84 m). Côté droit, en s.
 * Ce qui la fait reconnaître : face haute et droite, calandre à barrettes entre des phares effilés, gros bouclier à prise d'air et feux
 * antibrouillard dans des écrins chromés ; long toit plat, trois vitres de côté, hayon presque droit, feux arrière en griffes reliés par un bandeau
 * noir ; passages de roue et bas de caisse noirs. Et la livrée (exception au refus du lettrage réel, choix de l'utilisateur) : bleu nuit,
 * triple bande blanche sur les flancs coupée par le mot GENDARMERIE, chevrons rouges et jaunes sur le capot et le hayon, rampe bleue sur le toit,
 * deux feux bleus dans la calandre.
 */

const LIGHT = "#eef0f2";
const LED = "#fff6dc";
const HOUSING = "#23262c";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#5d626b";
const CHROME = "#c9ccd0";
const RAIL = "#b9bcc1";
const TAIL = "#d8402a";
const TAIL_DARK = "#6e1d16";
const PLATE = "#f1e6c8";
const WHITE = "#eef1f4";
const YELLOW = "#f2d21b";
const RED = "#d42a26";
const NAVY = "#1a2440";
const BAR = "#2b49a8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.gendarmerie`, empattement de la fiche). */
const AXLE_F = 0.978;
const AXLE_R = 3.618;

/** Bout de la caisse en s. */
const END = 4.596;

/** Rayon vers le flanc gauche (on écrit le mot de chaque côté, à l'endroit). */
const LEFT = new THREE.Vector3(1, 0, 0);

/**
 * Police à bâtons des lettres du mot GENDARMERIE : traits (suites de points) dans une case de 0,6 de large sur 1 de haut ; la largeur de chaque lettre
 * (avance) en plus.
 */
const GLYPHS: Readonly<Record<string, { w: number; strokes: readonly (readonly (readonly [number, number])[])[] }>> = {
  G: { w: 0.6, strokes: [[[0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.8], [0, 0.2], [0.15, 0], [0.45, 0], [0.6, 0.2], [0.6, 0.45], [0.35, 0.45]]] },
  E: { w: 0.55, strokes: [[[0.55, 1], [0, 1], [0, 0], [0.55, 0]], [[0, 0.5], [0.42, 0.5]]] },
  N: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]] },
  D: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.35, 1], [0.6, 0.75], [0.6, 0.25], [0.35, 0], [0, 0]]] },
  A: { w: 0.6, strokes: [[[0, 0], [0.3, 1], [0.6, 0]], [[0.12, 0.38], [0.48, 0.38]]] },
  R: { w: 0.6, strokes: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.62], [0.45, 0.5], [0, 0.5]], [[0.3, 0.5], [0.6, 0]]] },
  M: { w: 0.7, strokes: [[[0, 0], [0, 1], [0.35, 0.45], [0.7, 1], [0.7, 0]]] },
  I: { w: 0.1, strokes: [[[0.05, 0], [0.05, 1]]] },
};

/**
 * Mot écrit en traits posés sur la caisse, à l'endroit pour qui le regarde : `place(u, v)` donne le point du dessin (u le long du mot, v vers le haut,
 * en m) ; `h` hauteur des lettres, `stroke` épaisseur des traits.
 */
function lettering(k: SculptKit, word: string, h: number, stroke: number, color: string, lift: number, place: (u: number, v: number) => Guide): THREE.BufferGeometry[] {
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
function wordLength(word: string, h: number): number {
  return [...word].reduce((sum, ch) => sum + (GLYPHS[ch]!.w + 0.28) * h, -0.28 * h);
}

export const GENDARMERIE: Sculpt = {
  top: [
    [0, 0.8], [0.045, 0.9], [0.1, 0.96], [0.2, 0.99], [0.45, 1.02], [AXLE_F, 1.06], [1.45, 1.11], [2.2, 1.13], [3.0, 1.15], [3.618, 1.17], [4.3, 1.2],
    [4.45, 1.18], [4.55, 1.1], [END, 0.95],
  ],
  bottom: [[0, 0.36], [0.045, 0.3], [0.12, 0.27], [0.4, 0.25], [1.5, 0.24], [3.1, 0.24], [4.2, 0.27], [4.45, 0.3], [END, 0.38]],
  width: [
    [0, 0.62], [0.045, 0.76], [0.1, 0.85], [0.2, 0.895], [0.45, 0.915], [AXLE_F, 0.922], [2.2, 0.915], [AXLE_R, 0.922], [4.2, 0.91], [4.4, 0.88],
    [4.52, 0.83], [END, 0.72],
  ],
  cabin: [
    [1.45, 0, 0.8], [1.8, 1.4, 0.76], [2.15, 1.6, 0.72], [2.7, 1.646, 0.72], [3.6, 1.64, 0.72], [4.15, 1.62, 0.71], [4.3, 1.58, 0.69], [4.46, 0, 0.72],
  ],
  windows: { shield: [1.45, 2.15], rear: [4.3, 4.46], side: [1.45, 4.15], blackFrame: true },
  arch: 0.42,
  lamps: { head: [0.7, 0.92, 0.06], tail: [0.72, 1.1, 4.5] },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];

    // Phares effilés sous le bord du capot, qui remontent sur l'aile ; filet de diodes.
    const head = (grow: number): Guide[][] => [
      [g(0.5, 0.94 + grow * 0.4, 0.06, FRONT), g(0.66, 0.955 + grow, 0.08, frontTurn(12)), g(0.79, 0.965 + grow, 0.13, frontTurn(35)), g(0.87, 0.975 + grow, 0.24, frontTurn(65)), g(0.9, 0.985 + grow * 0.4, 0.38, frontTurn(85))],
      [g(0.52, 0.905 - grow * 0.4, 0.06, FRONT), g(0.66, 0.875 - grow, 0.08, frontTurn(12)), g(0.79, 0.88 - grow, 0.13, frontTurn(35)), g(0.87, 0.92 - grow, 0.24, frontTurn(65)), g(0.9, 0.965 - grow * 0.4, 0.38, frontTurn(85))],
    ];
    out.push(k.decal(head(0.012), HOUSING, 0.012, true, 1));
    out.push(k.decal(head(0), LIGHT, 0.018, true, 1));
    out.push(k.decal([[g(0.6, 0.888, 0.07, frontTurn(8)), g(0.75, 0.885, 0.1, frontTurn(25)), g(0.85, 0.915, 0.2, frontTurn(58))], [g(0.6, 0.878, 0.07, frontTurn(8)), g(0.75, 0.875, 0.1, frontTurn(25)), g(0.85, 0.902, 0.2, frontTurn(58))]], LED, 0.024));

    // Calandre noire en trapèze à barrettes chromées ; emblème neutre (losange) au milieu.
    const gx = [0, 0.25, 0.5];
    out.push(k.decal([gx.map((x) => g(x * 1.0, 0.89, 0.02, FRONT)), gx.map((x) => g(x * 1.06, 0.76, 0.02, FRONT)), gx.map((x) => g(x * 1.1, 0.64, 0.02, FRONT))], GLOSS, 0.012));
    for (const y of [0.82, 0.72]) out.push(k.decal([[g(0, y + 0.006, 0.02, FRONT), g(0.5, y + 0.006, 0.02, FRONT)], [g(0, y - 0.006, 0.02, FRONT), g(0.5, y - 0.006, 0.02, FRONT)]], MESH, 0.018));
    out.push(k.decal([[g(-0.05, 0.78, 0.02, FRONT), g(0, 0.83, 0.02, FRONT), g(0.05, 0.78, 0.02, FRONT)], [g(-0.05, 0.78, 0.02, FRONT), g(0, 0.73, 0.02, FRONT), g(0.05, 0.78, 0.02, FRONT)]], CHROME, 0.022, false));

    // Bouclier : grande prise d'air noire, plaque, écrins chromés en C des antibrouillards aux coins.
    const lx = [0, 0.28, 0.52];
    out.push(k.decal([lx.map((x) => g(x, 0.52, 0.01, FRONT)), lx.map((x) => g(x * 0.95, 0.36, 0.02, FRONT))], GLOSS, 0.01));
    out.push(k.plate(-0.26, 0.26, 0.535, 0.635, 0, FRONT, PLATE, 0.02, 2));
    out.push(k.decal([[g(0.62, 0.6, 0.05, frontTurn(25)), g(0.76, 0.6, 0.11, frontTurn(48))], [g(0.62, 0.4, 0.05, frontTurn(25)), g(0.76, 0.4, 0.11, frontTurn(48))]], HOUSING, 0.01));
    out.push(k.decal([[g(0.6, 0.62, 0.04, frontTurn(22)), g(0.64, 0.62, 0.05, frontTurn(26))], [g(0.62, 0.38, 0.05, frontTurn(24)), g(0.66, 0.38, 0.05, frontTurn(28))]], CHROME, 0.016));
    out.push(k.decal([[g(0.68, 0.47, 0.07, frontTurn(32)), g(0.74, 0.47, 0.1, frontTurn(44))], [g(0.68, 0.43, 0.07, frontTurn(32)), g(0.74, 0.43, 0.1, frontTurn(44))]], LIGHT, 0.018));

    // Bandes rouges et jaunes sur l'avant du capot : un fond jaune, des chevrons rouges qui pointent vers l'avant.
    const hood = (s: number): Guide[] => [0, 0.2, 0.4, 0.6, 0.76].map((x) => g(x, 2, s, DOWN));
    out.push(k.decal([hood(0.16), hood(0.32), hood(0.46)], YELLOW, 0.01));
    for (const c of [0.06, 0.3, 0.54]) {
      out.push(k.decal([[g(c, 2, 0.16, DOWN), g(c + 0.1, 2, 0.16, DOWN)], [g(c + 0.12, 2, 0.31, DOWN), g(c + 0.22, 2, 0.31, DOWN)], [g(Math.min(0.7, c + 0.24), 2, 0.46, DOWN), g(Math.min(0.78, c + 0.34), 2, 0.46, DOWN)]], RED, 0.012));
    }

    // Flancs : triple bande blanche, coupée par le mot GENDARMERIE sur la porte avant ; passages de roue et bas de caisse noirs ; lignes des portes,
    // poignées ; montants noirs.
    const H = 0.075, wl = wordLength("GENDARMERIE", H), w0 = 1.68, w1 = w0 + wl;
    for (const [y, half] of [[0.885, 0.017], [0.845, 0.006], [0.818, 0.006]] as const) {
      out.push(k.sideLine([[0.55, y], [1.0, y], [w0 - 0.05, y]], half, WHITE, 0.012));
      out.push(k.sideLine([[w1 + 0.05, y], [3.0, y + 0.01], [4.3, y + 0.02]], half, WHITE, 0.012));
    }
    out.push(...lettering(k, "GENDARMERIE", H, 0.013, WHITE, 0.012, (u, v) => g(1, 0.81 + v, w1 - u, SIDE)));
    out.push(...lettering(k, "GENDARMERIE", H, 0.013, WHITE, 0.012, (u, v) => g(-1, 0.81 + v, w0 + u, LEFT)));
    out.push(k.sideLine([[1.52, 0.35], [2.4, 0.33], [3.1, 0.35]], 0.07, DARK, 0.009));
    for (const a of [AXLE_F, AXLE_R]) {
      const arc: [number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = Math.PI * (1 - i / 6), r = 0.42 + 0.06;
        arc.push([a + Math.cos(t) * r, k.frame.wheelRadius + Math.sin(t) * r]);
      }
      arc[0]![1] = Math.max(arc[0]![1], 0.42);
      arc[6]![1] = Math.max(arc[6]![1], 0.42);
      out.push(k.sideLine(arc, 0.05, DARK, 0.011));
    }
    out.push(k.sideLine([[1.5, 0.45], [1.48, 0.8], [1.52, k.belt(1.52) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.55, 0.32], [2.55, k.belt(2.55) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.22, 0.62], [3.24, 0.75], [3.3, 0.88], [3.36, k.belt(3.36) - 0.015]], 0.005, DARK));
    for (const s of [2.25, 3.05]) out.push(k.sideLine([[s, k.belt(s) - 0.1], [s + 0.15, k.belt(s) - 0.1]], 0.013, GLOSS, 0.013));
    for (const s of [2.55, 3.4]) {
      const e = k.cabinEdge(s);
      for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.03, GLOSS, 4, false));
    }
    // Jonc chromé au-dessus des vitres, barres de toit claires.
    for (const m of [-1, 1]) {
      const pts = [1.9, 2.4, 3.2, 3.9, 4.2].map((s) => k.cabinEdge(s).top);
      for (let i = 0; i + 1 < pts.length; i++) out.push(tube(new THREE.Vector3(m * (pts[i]!.x + 0.006), pts[i]!.y - 0.006, pts[i]!.z), new THREE.Vector3(m * (pts[i + 1]!.x + 0.006), pts[i + 1]!.y - 0.006, pts[i + 1]!.z), 0.008, CHROME, 3, false));
      const rail = [2.2, 3.0, 3.8, 4.15].map((s) => k.cabinEdge(s).roof);
      for (let i = 0; i + 1 < rail.length; i++) out.push(tube(new THREE.Vector3(m * (rail[i]!.x - 0.04), rail[i]!.y + 0.03, rail[i]!.z), new THREE.Vector3(m * (rail[i + 1]!.x - 0.04), rail[i + 1]!.y + 0.03, rail[i + 1]!.z), 0.015, RAIL, 3, false));
    }

    // Rampe bleue sur l'avant du toit, sur ses pieds (les feux qui clignotent sont dessinés à part, `CAR_BODIES.gendarmerie.beacons`).
    out.push(box(1.12, 0.085, 0.2, 0, 1.705, k.z(2.38), BAR));
    for (const m of [-1, 1]) out.push(box(0.05, 0.05, 0.12, m * 0.5, 1.66, k.z(2.38), DARK));

    // Arrière : feux en griffes reliés par un bandeau noir ; chevrons rouges et jaunes sur le bas du hayon, bandeau bleu nuit (sans le mot, faute de
    // triangles : il est sur les flancs) ;
    // plaque ; bouclier noir.
    const tail = (grow: number): Guide[][] => [
      [g(0.56, 1.16 + grow, 4.56, REAR), g(0.72, 1.165 + grow, 4.53, rearTurn(20)), g(0.84, 1.16 + grow, 4.46, rearTurn(55)), g(0.9, 1.15 + grow, 4.36, rearTurn(85))],
      [g(0.58, 1.04 - grow, 4.57, REAR), g(0.72, 1.03 - grow, 4.54, rearTurn(20)), g(0.84, 1.05 - grow, 4.47, rearTurn(55)), g(0.9, 1.08 - grow, 4.36, rearTurn(85))],
    ];
    out.push(k.decal(tail(0.01), HOUSING, 0.014, true, 1));
    out.push(k.decal(tail(0), TAIL_DARK, 0.02, true, 1));
    for (const [x, a] of [[0.62, 8], [0.7, 18], [0.78, 35]] as const) {
      out.push(k.decal([[g(x - 0.012, 1.15, 4.55, rearTurn(a)), g(x + 0.012, 1.15, 4.55, rearTurn(a))], [g(x - 0.02, 1.05, 4.55, rearTurn(a)), g(x + 0.004, 1.05, 4.55, rearTurn(a))]], TAIL, 0.026));
    }
    out.push(k.decal([[0, 0.3, 0.56].map((x) => g(x, 1.15, END, REAR)), [0, 0.3, 0.58].map((x) => g(x, 1.06, END, REAR))], GLOSS, 0.012));
    const hatch = (y: number): Guide[] => [0, 0.2, 0.4, 0.55].map((x) => g(x, y, END, REAR));
    out.push(k.decal([hatch(1.02), hatch(0.8), hatch(0.62)], YELLOW, 0.012));
    for (const c of [0.0, 0.2, 0.4]) {
      out.push(k.decal([[g(c, 1.02, END, REAR), g(c + 0.08, 1.02, END, REAR)], [g(Math.min(0.55, c + 0.15), 0.62, END, REAR), g(Math.min(0.55, c + 0.23), 0.62, END, REAR)]], RED, 0.016));
    }
    out.push(k.plate(-0.5, 0.5, 0.86, 0.94, END, REAR, NAVY, 0.02, 4));
    out.push(k.plate(-0.26, 0.26, 0.65, 0.75, END, REAR, PLATE, 0.022, 2));
    out.push(k.decal([[0, 0.3, 0.6, 0.78].map((x) => g(x, 0.58, END, x > 0.65 ? rearTurn(35) : REAR)), [0, 0.3, 0.6, 0.8].map((x) => g(x, 0.38, END, x > 0.65 ? rearTurn(40) : REAR))], DARK, 0.009));
    return out;
  },

  // Rétroviseurs noirs : ils débordent du gabarit (mis à part, comme ceux du fourgon, D279).
  mirrors: (k) => [-1, 1].flatMap((m) => [
    box(0.1, 0.04, 0.08, m * 0.86, 1.14, k.z(1.6), DARK),
    box(0.09, 0.13, 0.16, m * 0.95, 1.17, k.z(1.62), DARK),
  ]),
};
