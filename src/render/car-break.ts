import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { paint, tube } from "./vehicle-model";

/**
 * Break (Augusta Morvandelle, D274) sculpté d'après les photos fournies par l'utilisateur : la silhouette d'un break haut de gamme allemand des
 * années 2020 (profil), la face de la berline de la même génération (trois-quarts avant), l'arrière inspiré de la grande berline de la même marque
 * (bandeau lumineux, diffuseur) ; mesures 4,83 × 1,86 × 1,45 m (empattement de la fiche de conduite gardé, 2,82 m). Côté droit, en s.
 * Ce qui le fait reconnaître : capot très long, grande calandre noire en octogone, prises d'air verticales aux coins, phares fins ; long toit presque plat
 * avec barres de toit et becquet, encadrement chromé des vitres qui finit en pointe sur le montant arrière ; à l'arrière, un trait rouge d'un feu à
 * l'autre, feux en segments, diffuseur noir souligné d'argent et deux sorties trapézoïdales ; rétroviseurs noirs, bas de caisse noir.
 */

const LIGHT = "#f5ecd2";
const LED = "#fff6dc";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#2b2e34";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const RAIL = "#b8bcc2";
const TAIL = "#e0442c";
const TAIL_DARK = "#9c2a1c";
const AMBER = "#f1a03a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Phare droit, fin, au-dessus de la prise d'air : [x, haut, bas, s, angle du rayon]. */
const HEAD: readonly (readonly [number, number, number, number, number])[] = [
  [0.5, 0.655, 0.635, 0.03, 4],
  [0.6, 0.668, 0.628, 0.04, 12],
  [0.7, 0.68, 0.628, 0.07, 28],
  [0.79, 0.695, 0.64, 0.13, 52],
  [0.86, 0.71, 0.662, 0.23, 76],
  [0.885, 0.722, 0.705, 0.34, 90],
];

/** Feu arrière droit : il prolonge le trait rouge, s'épaissit sur le coin et file sur l'aile. */
const TAILLAMP: readonly (readonly [number, number, number, number, number])[] = [
  [0.48, 0.95, 0.925, 4.74, 0],
  [0.62, 0.958, 0.905, 4.73, 6],
  [0.74, 0.965, 0.895, 4.69, 28],
  [0.83, 0.97, 0.91, 4.62, 62],
  [0.88, 0.975, 0.955, 4.52, 88],
];

export const BREAK: Sculpt = {
  top: [
    [0, 0.6], [0.05, 0.665], [0.15, 0.71], [0.35, 0.745], [0.9, 0.79], [1.45, 0.83], [2.2, 0.88], [3.1, 0.93], [3.9, 0.97], [4.45, 0.985],
    [4.62, 0.98], [4.73, 0.94], [4.786, 0.84],
  ],
  bottom: [[0, 0.25], [0.05, 0.2], [0.15, 0.185], [0.35, 0.17], [0.6, 0.16], [3.2, 0.15], [4.3, 0.17], [4.55, 0.19], [4.7, 0.21], [4.786, 0.26]],
  width: [
    [0, 0.57], [0.05, 0.71], [0.15, 0.81], [0.3, 0.87], [0.5, 0.9], [0.908, 0.912], [3.3, 0.91], [3.728, 0.918],
    [4.2, 0.905], [4.5, 0.87], [4.7, 0.8], [4.786, 0.66],
  ],
  cabin: [[1.45, 0, 0.78], [1.85, 1.12, 0.74], [2.3, 1.38, 0.67], [2.8, 1.45, 0.675], [3.6, 1.43, 0.67], [4.2, 1.4, 0.65], [4.5, 1.37, 0.62], [4.66, 0, 0.7]],
  windows: { shield: [1.45, 2.3], rear: [4.5, 4.66], side: [1.45, 4.2] },
  arch: 0.41,
  lamps: { head: [0.68, 0.655, 0.07], tail: [0.62, 0.93, 4.73] },

  paint: (k) => [
    // Becquet au bout du toit, au-dessus du hayon.
    paint(new THREE.BoxGeometry(1.18, 0.03, 0.2).translate(0, 1.365, k.z(4.55)), "#ffffff"),
  ],

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares fins : boîtier sombre, glace, segments de diodes en haut ; clignotant au bout.
    const head = (grow: number, inner = 0): Guide[][] => [
      HEAD.map(([x, t, , s, a], i) => g(x, t + grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) - inner, s, frontTurn(a))),
      HEAD.map(([x, , b, s, a], i) => g(x, b - grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) + inner, s, frontTurn(a))),
    ];
    out.push(k.decal(head(0.01), HOUSING, 0.012, true, 2));
    out.push(k.decal(head(0, 0.005), LIGHT, 0.018, true, 2));
    out.push(k.decal([HEAD.slice(0, 5).map(([x, t, , s, a]) => g(x, t - 0.005, s, frontTurn(a))), HEAD.slice(0, 5).map(([x, t, , s, a]) => g(x, t - 0.013, s, frontTurn(a)))], LED, 0.022, true, 1));
    out.push(k.decal([[g(0.885, 0.716, 0.27, SIDE), g(0.885, 0.72, 0.32, SIDE)], [g(0.885, 0.702, 0.27, SIDE), g(0.885, 0.71, 0.32, SIDE)]], AMBER, 0.02));

    // Grande calandre en octogone : large en haut, plus large au milieu, rétrécie en bas ; maillage suggéré, emblème chromé neutre en haut, plaque en bas.
    const xs = [0, 0.16, 0.32, 0.46];
    out.push(k.decal([
      xs.map((x) => g(x, 0.625, 0, FRONT)),
      xs.map((x) => g(x * 1.13, 0.5, 0, FRONT)),
      xs.map((x) => g(x * 1.08, 0.36, 0, FRONT)),
      xs.map((x) => g(x * 0.95, 0.26, 0.02, FRONT)),
    ], GLOSS, 0.008));
    for (const y of [0.58, 0.535, 0.49, 0.445, 0.4]) {
      const w = 0.46 * (y > 0.5 ? 1 + (0.13 * (0.625 - y)) / 0.125 : 1.13 - (0.05 * (0.5 - y)) / 0.14) - 0.04;
      out.push(k.decal([[0, w / 2, w].map((x) => g(x, y + 0.005, 0, FRONT)), [0, w / 2, w].map((x) => g(x, y - 0.005, 0, FRONT))], MESH, 0.011));
    }
    out.push(k.plate(-0.09, 0.09, 0.59, 0.615, 0, FRONT, CHROME, 0.016, 2));
    out.push(k.plate(-0.26, 0.26, 0.28, 0.385, 0, FRONT, PLATE, 0.018, 2));

    // Prises d'air verticales aux coins : un trapèze noir encadré, avec deux lames.
    out.push(k.decal([
      [g(0.63, 0.6, 0.04, frontTurn(14)), g(0.74, 0.6, 0.08, frontTurn(34)), g(0.83, 0.59, 0.14, frontTurn(58))],
      [g(0.62, 0.43, 0.04, frontTurn(14)), g(0.74, 0.43, 0.08, frontTurn(36)), g(0.85, 0.43, 0.16, frontTurn(62))],
      [g(0.64, 0.27, 0.05, frontTurn(16)), g(0.75, 0.27, 0.1, frontTurn(38)), g(0.84, 0.28, 0.17, frontTurn(62))],
    ], DARK, 0.008));
    for (const t of [0.4, 0.62]) out.push(k.decal([[g(0.64 + 0.1 * t, 0.59, 0.05 + 0.05 * t, frontTurn(18 + 22 * t)), g(0.66 + 0.1 * t, 0.59, 0.06 + 0.06 * t, frontTurn(20 + 22 * t))], [g(0.66 + 0.1 * t, 0.28, 0.06 + 0.06 * t, frontTurn(20 + 22 * t)), g(0.68 + 0.1 * t, 0.28, 0.07 + 0.06 * t, frontTurn(22 + 22 * t))]], TRIM, 0.012));

    // Montants noirs (central, et entre la porte arrière et la custode).
    for (const s of [2.85, 3.78]) {
      const e = k.cabinEdge(s);
      for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.032, GLOSS, 4, false));
    }
    // Encadrement chromé des vitres (pied et haut) qui se rejoignent en pointe sur le montant arrière ; barres de toit argent.
    for (const m of [-1, 1]) {
      const strip = (pts: THREE.Vector3[], r: number, color: string, dy: number): void => {
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]!, c = pts[i + 1]!;
          out.push(tube(new THREE.Vector3(m * (a.x + 0.006), a.y + dy, a.z), new THREE.Vector3(m * (c.x + 0.006), c.y + dy, c.z), r, color, 3, false));
        }
      };
      strip([1.6, 2.2, 2.85, 3.5, 4.18].map((s) => k.cabinEdge(s).base), 0.008, CHROME, 0.025);
      strip([1.62, 2.0, 2.3, 2.8, 3.6, 4.18].map((s) => k.cabinEdge(s).top), 0.008, CHROME, -0.012);
      strip([2.5, 3.1, 3.7, 4.3].map((s) => k.cabinEdge(s).roof.clone().add(new THREE.Vector3(-0.03, 0, 0))), 0.016, RAIL, 0.03);
      for (const s of [2.5, 4.3]) {
        const r = k.cabinEdge(s).roof;
        out.push(tube(new THREE.Vector3(m * (r.x - 0.03), r.y - 0.01, r.z), new THREE.Vector3(m * (r.x - 0.03), r.y + 0.03, r.z), 0.02, DARK, 4));
      }
    }

    // Flancs : lignes de portes, poignées, bas de caisse noir.
    out.push(k.sideLine([[1.42, 0.32], [1.4, 0.6], [1.46, k.belt(1.46) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.85, 0.24], [2.85, k.belt(2.85) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.28, 0.24], [3.3, 0.62], [3.42, 0.79], [3.5, k.belt(3.5) - 0.015]], 0.005, DARK));
    for (const s of [2.5, 3.32]) out.push(k.sideLine([[s, k.belt(s) - 0.08], [s + 0.15, k.belt(s) - 0.08]], 0.012, TRIM, 0.01));
    out.push(k.sideLine([[1.5, 0.215], [2.4, 0.21], [3.25, 0.215]], 0.03, DARK, 0.009));

    // Rétroviseurs noirs.
    for (const m of [-1, 1]) {
      out.push(paint(podLoft([
        { x: m * 0.81, y: 0.9, z: k.z(1.55), w: 0.03, h: 0.035 },
        { x: m * 0.87, y: 0.92, z: k.z(1.6), w: 0.06, h: 0.055 },
        { x: m * 0.87, y: 0.92, z: k.z(1.73), w: 0.055, h: 0.05 },
      ], DARK, 6), DARK));
    }

    // Arrière : le trait rouge d'un feu à l'autre, les feux en segments, sur un fond sombre.
    out.push(k.decal([[0, 0.2, 0.4, 0.5].map((x) => g(x, 0.944, 4.74, REAR)), [0, 0.2, 0.4, 0.5].map((x) => g(x, 0.93, 4.74, REAR))], TAIL, 0.018));
    const tail = (grow: number): Guide[][] => [
      TAILLAMP.map(([x, t, , s, a], i) => g(x, t + (i > 0 ? grow : 0), s, rearTurn(a))),
      TAILLAMP.map(([x, , b, s, a], i) => g(x, b - (i > 0 ? grow : 0), s, rearTurn(a))),
    ];
    out.push(k.decal(tail(0.01), HOUSING, 0.014, true, 2));
    out.push(k.decal(tail(0), TAIL_DARK, 0.02, true, 2));
    for (const [x, s, a] of [[0.56, 4.735, 2], [0.65, 4.725, 8], [0.74, 4.69, 28]] as const) {
      out.push(k.decal([[g(x - 0.035, 0.955, s, rearTurn(a)), g(x + 0.035, 0.957, s, rearTurn(a))], [g(x - 0.035, 0.92, s, rearTurn(a)), g(x + 0.035, 0.915, s, rearTurn(a))]], TAIL, 0.026));
    }
    // Hayon : plaque ; bas : diffuseur noir souligné d'argent, deux sorties trapézoïdales, catadioptres.
    out.push(k.plate(-0.26, 0.26, 0.6, 0.705, 4.77, REAR, PLATE, 0.012, 2));
    out.push(k.decal([[0, 0.25, 0.5, 0.66, 0.76].map((x) => g(x, 0.4, 4.74, rearTurn(x > 0.6 ? 30 : 0))), [0, 0.25, 0.5, 0.66, 0.78].map((x) => g(x, 0.23, 4.74, rearTurn(x > 0.6 ? 30 : 0)))], DARK, 0.008));
    out.push(k.decal([[0, 0.3, 0.6].map((x) => g(x, 0.41, 4.74, REAR)), [0, 0.3, 0.6].map((x) => g(x, 0.395, 4.74, REAR))], CHROME, 0.013));
    out.push(k.decal([[g(0.42, 0.33, 4.75, REAR), g(0.62, 0.33, 4.74, REAR)], [g(0.44, 0.26, 4.75, REAR), g(0.6, 0.26, 4.74, REAR)]], CHROME, 0.014));
    out.push(k.decal([[g(0.45, 0.32, 4.75, REAR), g(0.59, 0.32, 4.74, REAR)], [g(0.46, 0.272, 4.75, REAR), g(0.58, 0.272, 4.74, REAR)]], GLOSS, 0.018));
    out.push(k.decal([[g(0.7, 0.44, 4.72, rearTurn(25)), g(0.78, 0.44, 4.68, rearTurn(40))], [g(0.7, 0.42, 4.72, rearTurn(25)), g(0.78, 0.42, 4.68, rearTurn(40))]], TAIL_DARK, 0.012));
    return out;
  },
};
