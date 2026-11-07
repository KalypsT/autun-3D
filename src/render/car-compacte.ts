import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Compacte (Éduen Arroux, D273) sculptée d'après les photos fournies par l'utilisateur (compacte française cinq portes des années 2020, trois photos :
 * trois-quarts avant, face, arrière) et ses mesures (4,37 × 1,85 × 1,44 m ; empattement de la fiche de conduite gardé, 2,64 m). Côté droit, en s.
 * Ce qui la fait reconnaître : capot long et bas, grande calandre noire en trapèze avec l'écusson au milieu, phares fins qui filent sur l'aile,
 * et surtout les « crocs » : une lame de feux de jour qui descend de chaque phare vers le bas du pare-chocs, à côté d'une prise d'air noire ;
 * pare-brise très couché, toit fuyant, becquet ; à l'arrière, un bandeau noir brillant d'un feu à l'autre, et dans chaque feu trois griffes
 * rouges ; rétroviseurs noirs, jonc noir au bas des portes, diffuseur noir et deux sorties chromées.
 */

const LIGHT = "#f5ecd2";
const LED = "#fff6dc";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#2b2e34";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const TAIL = "#e0442c";
const TAIL_DARK = "#9c2a1c";
const AMBER = "#f1a03a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Phare droit, fin : [x, haut, bas, s, angle du rayon], de la pointe contre la calandre au bout sur l'aile. */
const HEAD: readonly (readonly [number, number, number, number, number])[] = [
  [0.46, 0.64, 0.618, 0.02, 0],
  [0.57, 0.655, 0.612, 0.03, 8],
  [0.68, 0.668, 0.612, 0.05, 22],
  [0.77, 0.682, 0.628, 0.1, 45],
  [0.84, 0.698, 0.655, 0.2, 72],
  [0.875, 0.712, 0.69, 0.32, 88],
  [0.885, 0.722, 0.716, 0.42, 90],
];

/** Croc de feux de jour : ses deux bords, du coin du phare au bas du pare-chocs. */
const FANG_A: readonly (readonly [number, number, number, number])[] = [[0.775, 0.612, 0.09, 42], [0.8, 0.5, 0.13, 52], [0.84, 0.39, 0.17, 62]];
const FANG_B: readonly (readonly [number, number, number, number])[] = [[0.805, 0.612, 0.115, 50], [0.83, 0.5, 0.155, 58], [0.862, 0.39, 0.2, 68]];

export const COMPACTE: Sculpt = {
  top: [
    [0, 0.62], [0.04, 0.675], [0.12, 0.71], [0.3, 0.735], [0.8, 0.79], [1.3, 0.83], [1.75, 0.875], [2.5, 0.925], [3.2, 0.965], [3.6, 0.99],
    [3.95, 0.995], [4.15, 0.975], [4.27, 0.925], [4.326, 0.83],
  ],
  bottom: [[0, 0.24], [0.04, 0.2], [0.12, 0.185], [0.3, 0.17], [0.5, 0.16], [1.4, 0.15], [3.0, 0.15], [4.0, 0.17], [4.2, 0.19], [4.29, 0.21], [4.326, 0.25]],
  width: [
    [0, 0.56], [0.04, 0.7], [0.12, 0.8], [0.25, 0.86], [0.45, 0.893], [0.87, 0.902], [1.5, 0.898], [2.4, 0.892], [3.1, 0.9], [3.51, 0.907],
    [3.9, 0.893], [4.15, 0.86], [4.27, 0.8], [4.326, 0.66],
  ],
  cabin: [
    [1.32, 0, 0.78], [1.72, 1.15, 0.74], [2.15, 1.405, 0.66], [2.65, 1.44, 0.665], [3.25, 1.425, 0.655], [3.7, 1.385, 0.62], [3.9, 1.18, 0.68], [4.06, 0, 0.76],
  ],
  windows: { shield: [1.32, 2.15], rear: [3.7, 4.06], side: [1.32, 3.7] },
  arch: 0.4,
  lamps: { head: [0.66, 0.64, 0.05], tail: [0.64, 0.91, 4.29] },

  paint: (k) => [
    // Becquet au bout du toit.
    box(1.16, 0.03, 0.2, 0, 1.39, k.z(3.78), "#ffffff"),
  ],

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares fins : boîtier sombre, glace, filet de diodes en bas ; clignotant au bout sur l'aile.
    const head = (grow: number, inner = 0): Guide[][] => [
      HEAD.map(([x, t, , s, a], i) => g(x, t + grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) - inner, s, frontTurn(a))),
      HEAD.map(([x, , b, s, a], i) => g(x, b - grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) + inner, s, frontTurn(a))),
    ];
    out.push(k.decal(head(0.01), HOUSING, 0.012, true, 2));
    out.push(k.decal(head(0, 0.005), LIGHT, 0.018, true, 2));
    out.push(k.decal([HEAD.slice(0, 5).map(([x, , b, s, a]) => g(x, b + 0.016, s, frontTurn(a))), HEAD.slice(0, 5).map(([x, , b, s, a]) => g(x, b + 0.006, s, frontTurn(a)))], LED, 0.022, true, 1));
    out.push(k.decal([[g(0.88, 0.716, 0.36, SIDE), g(0.88, 0.722, 0.41, SIDE)], [g(0.88, 0.7, 0.36, SIDE), g(0.88, 0.714, 0.41, SIDE)]], AMBER, 0.02));

    // Prise d'air noire au coin, à côté du croc, avec deux lames ; puis le croc lui-même, une lame claire qui descend du phare.
    out.push(k.decal([
      [g(0.64, 0.56, 0.05, frontTurn(18)), g(0.72, 0.575, 0.08, frontTurn(35)), g(0.78, 0.585, 0.11, frontTurn(48))],
      [g(0.6, 0.38, 0.05, frontTurn(18)), g(0.7, 0.38, 0.1, frontTurn(38)), g(0.8, 0.38, 0.15, frontTurn(58))],
    ], DARK, 0.008));
    for (const y of [0.5, 0.44]) out.push(k.decal([[g(0.63, y + 0.007, 0.05, frontTurn(18)), g(0.74, y + 0.007, 0.1, frontTurn(40))], [g(0.63, y - 0.007, 0.05, frontTurn(18)), g(0.74, y - 0.007, 0.1, frontTurn(40))]], TRIM, 0.012));
    out.push(k.decal([FANG_A.map(([x, y, s, a]) => g(x, y, s, frontTurn(a))), FANG_B.map(([x, y, s, a]) => g(x, y, s, frontTurn(a)))], LED, 0.016));

    // Grande calandre en trapèze (plus large en haut), maillage suggéré par des lignes plus claires, écusson en blason au milieu.
    const xs = [0, 0.15, 0.3, 0.44];
    out.push(k.decal([xs.map((x) => g(x, 0.625, 0, FRONT)), xs.map((x) => g(x * 0.96, 0.52, 0, FRONT)), xs.map((x) => g(x * 0.9, 0.41, 0, FRONT))], GLOSS, 0.008));
    for (const y of [0.585, 0.545, 0.505, 0.465]) {
      const w = 0.44 * (0.9 + (0.1 * (y - 0.41)) / 0.215) - 0.03;
      out.push(k.decal([[0, w / 2, w].map((x) => g(x, y + 0.004, 0, FRONT)), [0, w / 2, w].map((x) => g(x, y - 0.004, 0, FRONT))], MESH, 0.011));
    }
    out.push(k.decal([[g(-0.045, 0.59, 0, FRONT), g(0, 0.597, 0, FRONT), g(0.045, 0.59, 0, FRONT)], [g(-0.036, 0.525, 0, FRONT), g(0, 0.5, 0, FRONT), g(0.036, 0.525, 0, FRONT)]], CHROME, 0.015, false));
    out.push(k.decal([[g(-0.03, 0.578, 0, FRONT), g(0, 0.583, 0, FRONT), g(0.03, 0.578, 0, FRONT)], [g(-0.024, 0.532, 0, FRONT), g(0, 0.515, 0, FRONT), g(0.024, 0.532, 0, FRONT)]], DARK, 0.018, false));

    // Grille basse sur toute la largeur, plaque au milieu.
    const ls = [0, 0.2, 0.4, 0.58];
    out.push(k.decal([ls.map((x) => g(x, 0.385, 0, FRONT)), ls.map((x) => g(x * 1.08, 0.255, 0.02, FRONT))], DARK, 0.007));
    out.push(k.plate(-0.26, 0.26, 0.27, 0.375, 0, FRONT, PLATE, 0.012, 2));

    // Montant central noir. Lignes de portes (la porte arrière contourne la roue), deux poignées, jonc noir au bas des portes.
    const b = k.cabinEdge(2.62);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * b.base.x, b.base.y + 0.02, b.base.z), new THREE.Vector3(m * b.top.x, b.top.y, b.top.z), 0.035, GLOSS, 4, false));
    out.push(k.sideLine([[1.36, 0.36], [1.34, 0.6], [1.38, k.belt(1.38) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.62, 0.24], [2.62, k.belt(2.62) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.08, 0.24], [3.1, 0.62], [3.2, 0.78], [3.26, k.belt(3.26) - 0.015]], 0.005, DARK));
    for (const s of [2.33, 3.1]) out.push(k.sideLine([[s, k.belt(s) - 0.085], [s + 0.14, k.belt(s) - 0.085]], 0.013, TRIM, 0.01));
    out.push(k.sideLine([[1.42, 0.215], [2.2, 0.21], [3.0, 0.215]], 0.028, DARK, 0.009));

    // Rétroviseurs noirs, au pied du montant.
    for (const m of [-1, 1]) {
      out.push(paint(podLoft([
        { x: m * 0.8, y: 0.9, z: k.z(1.4), w: 0.03, h: 0.035 },
        { x: m * 0.86, y: 0.92, z: k.z(1.45), w: 0.06, h: 0.055 },
        { x: m * 0.86, y: 0.92, z: k.z(1.57), w: 0.055, h: 0.05 },
      ], DARK, 6), DARK));
    }

    // Arrière : bandeau noir brillant d'un feu à l'autre, et dans chaque feu, trois griffes rouges sur fond rouge sombre, qui tournent sur l'aile.
    const band = [0, 0.2, 0.4, 0.55, 0.68];
    out.push(k.decal([band.map((x) => g(x, 0.96, 4.29, REAR)), band.map((x) => g(x, 0.86, 4.29, REAR))], GLOSS, 0.01));
    out.push(k.decal([
      [g(0.5, 0.958, 4.29, REAR), g(0.66, 0.962, 4.28, rearTurn(15)), g(0.77, 0.962, 4.24, rearTurn(45)), g(0.85, 0.958, 4.16, rearTurn(80))],
      [g(0.5, 0.862, 4.29, REAR), g(0.66, 0.858, 4.28, rearTurn(15)), g(0.77, 0.87, 4.24, rearTurn(45)), g(0.85, 0.905, 4.16, rearTurn(80))],
    ], TAIL_DARK, 0.016, true, 1));
    for (const [x, s, a] of [[0.55, 4.29, 0], [0.64, 4.285, 10], [0.73, 4.26, 30]] as const) {
      out.push(k.decal([[g(x - 0.012, 0.952, s, rearTurn(a)), g(x + 0.012, 0.952, s, rearTurn(a))], [g(x + 0.018, 0.868, s, rearTurn(a)), g(x + 0.042, 0.868, s, rearTurn(a))]], TAIL, 0.022));
    }
    // Écusson sur le bandeau, plaque, diffuseur noir avec deux sorties chromées, catadioptres verticaux aux coins.
    out.push(k.plate(-0.035, 0.035, 0.885, 0.935, 4.3, REAR, CHROME, 0.016));
    out.push(k.plate(-0.26, 0.26, 0.42, 0.53, 4.3, REAR, PLATE, 0.012, 2));
    out.push(k.decal([[0, 0.25, 0.5, 0.64, 0.74].map((x) => g(x, 0.37, 4.28, rearTurn(x > 0.6 ? 30 : 0))), [0, 0.25, 0.5, 0.64, 0.76].map((x) => g(x, 0.235, 4.28, rearTurn(x > 0.6 ? 30 : 0)))], DARK, 0.008));
    out.push(k.decal([[g(0.42, 0.315, 4.29, REAR), g(0.6, 0.315, 4.28, REAR)], [g(0.44, 0.26, 4.29, REAR), g(0.58, 0.26, 4.28, REAR)]], CHROME, 0.014));
    out.push(k.decal([[g(0.72, 0.44, 4.24, rearTurn(35)), g(0.76, 0.44, 4.22, rearTurn(45))], [g(0.72, 0.35, 4.24, rearTurn(35)), g(0.76, 0.35, 4.22, rearTurn(45))]], TAIL_DARK, 0.012));
    return out;
  },
};
