import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Citadine (Éduen Moineau, D272) sculptée d'après les photos fournies par l'utilisateur (citadine française cinq portes des années 2010, D271) et ses
 * mesures (4,06 × 1,73 × 1,45 m, empattement 2,59 m, porte-à-faux avant 0,80 m). Tout est dessiné pour le côté droit, en s (m depuis le nez).
 * Ce qui la fait reconnaître : capot haut et court qui plonge sur une face ronde, phares en larme qui remontent le long de l'aile, bandeau noir entre eux,
 * grande grille basse en trapèze ; pare-brise très couché, toit qui fuit vers un becquet, ceinture qui monte vers l'arrière ; hanches larges sur la roue
 * arrière ; feux qui s'étirent du hayon sur l'aile ; poignées arrière cachées ; creux noir et jonc chromé au bas des portes.
 */

const LIGHT = "#f5ecd2";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const TAIL = "#e0442c";
const TAIL_DARK = "#9c2a1c";
const AMBER = "#f1a03a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Phare droit : contour [x, haut, bas, s, angle du rayon] de la pointe intérieure (face avant) au bout sur l'aile. */
const HEAD: readonly (readonly [number, number, number, number, number])[] = [
  [0.2, 0.603, 0.593, 0.02, 0],
  [0.34, 0.632, 0.585, 0.02, 4],
  [0.5, 0.66, 0.578, 0.03, 14],
  [0.64, 0.68, 0.582, 0.06, 32],
  [0.74, 0.7, 0.605, 0.12, 55],
  [0.8, 0.723, 0.648, 0.24, 78],
  [0.82, 0.748, 0.705, 0.37, 88],
  [0.82, 0.768, 0.758, 0.48, 90],
];

/** Feu arrière droit : de la pointe intérieure (hayon) au bout sur l'aile. */
const TAILLAMP: readonly (readonly [number, number, number, number, number])[] = [
  [0.26, 0.9, 0.882, 4.0, 0],
  [0.38, 0.93, 0.85, 4.0, 0],
  [0.52, 0.952, 0.835, 4.0, 6],
  [0.65, 0.962, 0.835, 3.98, 25],
  [0.75, 0.968, 0.85, 3.94, 55],
  [0.81, 0.974, 0.88, 3.88, 80],
  [0.83, 0.98, 0.95, 3.79, 90],
];

export const CITADINE: Sculpt = {
  top: [
    [0, 0.62], [0.04, 0.685], [0.12, 0.72], [0.3, 0.758], [0.7, 0.81], [1.15, 0.875], [1.6, 0.905], [2.3, 0.945], [3.0, 0.985], [3.45, 1.005],
    [3.8, 1.0], [3.95, 0.985], [4.02, 0.94], [4.044, 0.85],
  ],
  bottom: [[0, 0.3], [0.04, 0.22], [0.12, 0.19], [0.3, 0.18], [0.5, 0.17], [1.2, 0.16], [3.0, 0.16], [3.8, 0.18], [3.95, 0.21], [4.02, 0.24], [4.044, 0.3]],
  width: [
    [0, 0.5], [0.04, 0.64], [0.12, 0.75], [0.25, 0.815], [0.45, 0.85], [0.8, 0.858], [1.3, 0.856], [2.2, 0.848], [2.9, 0.856], [3.39, 0.865],
    [3.75, 0.85], [3.92, 0.81], [4.0, 0.75], [4.044, 0.6],
  ],
  cabin: [
    [1.15, 0, 0.74], [1.5, 1.17, 0.7], [1.95, 1.41, 0.625], [2.45, 1.45, 0.635], [3.0, 1.435, 0.625], [3.4, 1.385, 0.59], [3.62, 1.17, 0.66], [3.8, 0, 0.72],
  ],
  windows: { shield: [1.15, 1.95], rear: [3.4, 3.8], side: [1.15, 3.4], black: [3.4, 3.62] },
  arch: 0.385,
  lamps: { head: [0.5, 0.63, 0.03], tail: [0.58, 0.91, 4.0] },

  paint: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Becquet au bout du toit, qui déborde au-dessus de la lunette.
    out.push(box(1.1, 0.03, 0.22, 0, 1.385, k.z(3.47), "#ffffff"));
    // Rétroviseurs couleur caisse, au pied du montant.
    for (const s of [-1, 1]) {
      out.push(podLoft([
        { x: s * 0.79, y: 0.985, z: k.z(1.27), w: 0.03, h: 0.04 },
        { x: s * 0.82, y: 0.99, z: k.z(1.33), w: 0.055, h: 0.06 },
        { x: s * 0.82, y: 0.99, z: k.z(1.44), w: 0.05, h: 0.055 },
      ], "#ffffff", 6));
    }
    return out;
  },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    const head = (grow: number, inner = 0): Guide[][] => [
      HEAD.map(([x, t, , s, a], i) => g(x, t + grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) - inner, s, frontTurn(a))),
      HEAD.map(([x, , b, s, a], i) => g(x, b - grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) + inner, s, frontTurn(a))),
    ];
    // Phares : un boîtier sombre, la glace claire dedans, la ligne de feux de jour plus claire en bas ; un clignotant au bout de l'aile.
    out.push(k.decal(head(0.012), HOUSING, 0.012, true, 2));
    out.push(k.decal(head(0, 0.006), LIGHT, 0.018, true, 2));
    out.push(k.decal([HEAD.slice(1, 5).map(([x, , b, s, a]) => g(x, b + 0.022, s, frontTurn(a))), HEAD.slice(1, 5).map(([x, , b, s, a]) => g(x, b + 0.008, s, frontTurn(a)))], "#fff6dc", 0.022, true, 1));
    out.push(k.decal([[g(0.82, 0.752, 0.42, SIDE), g(0.82, 0.762, 0.47, SIDE)], [g(0.82, 0.738, 0.42, SIDE), g(0.82, 0.756, 0.47, SIDE)]], AMBER, 0.016));

    // Bandeau noir entre les phares (il plonge vers l'écusson), filet chromé dessous, écusson rond au milieu.
    out.push(k.decal([[g(0, 0.628, 0, FRONT), g(0.1, 0.622, 0, FRONT), g(0.21, 0.607, 0.02, FRONT)], [g(0, 0.54, 0, FRONT), g(0.1, 0.556, 0, FRONT), g(0.21, 0.588, 0.02, FRONT)]], GLOSS, 0.01));
    out.push(k.decal([[g(0.07, 0.546, 0, FRONT), g(0.2, 0.566, 0, FRONT), g(0.34, 0.572, 0.02, FRONT)], [g(0.07, 0.534, 0, FRONT), g(0.2, 0.554, 0, FRONT), g(0.34, 0.562, 0.02, FRONT)]], CHROME, 0.012));
    const badge = k.project(g(0, 0.588, 0, FRONT), 0.006).p;
    const disc = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 8).rotateX(Math.PI / 2).translate(badge.x, badge.y, badge.z);
    out.push(paint(disc, CHROME));

    // Grande grille basse en trapèze, deux lames, plaque ; poches sombres des feux de jour aux coins, avec leur barrette claire.
    const xs = [0, 0.15, 0.3, 0.42, 0.52];
    out.push(k.decal([xs.map((x) => g(x * 0.92, 0.44, 0, FRONT)), xs.map((x) => g(x, 0.34, 0, FRONT)), xs.map((x) => g(x * 1.1, 0.235, 0.02, FRONT))], DARK, 0.007));
    for (const y of [0.405, 0.3]) out.push(k.decal([xs.slice(0, 4).map((x) => g(x, y + 0.008, 0, FRONT)), xs.slice(0, 4).map((x) => g(x, y - 0.008, 0, FRONT))], TRIM, 0.011));
    out.push(k.plate(-0.26, 0.26, 0.285, 0.39, 0, FRONT, PLATE, 0.012, 2));
    out.push(k.decal([[g(0.6, 0.37, 0.05, frontTurn(25)), g(0.7, 0.37, 0.1, frontTurn(45)), g(0.77, 0.36, 0.17, frontTurn(65))], [g(0.6, 0.26, 0.05, frontTurn(25)), g(0.7, 0.26, 0.1, frontTurn(45)), g(0.77, 0.27, 0.17, frontTurn(65))]], DARK, 0.007));
    out.push(k.decal([[g(0.62, 0.33, 0.05, frontTurn(25)), g(0.71, 0.33, 0.1, frontTurn(45))], [g(0.62, 0.315, 0.05, frontTurn(25)), g(0.71, 0.315, 0.1, frontTurn(45))]], "#fff6dc", 0.012));

    // Montant central noir (les vitres sont les faces de l'habitacle, `windows`), jonc chromé au pied des vitres.
    const b = k.cabinEdge(2.42);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * b.base.x, b.base.y + 0.02, b.base.z), new THREE.Vector3(m * b.top.x, b.top.y, b.top.z), 0.035, GLOSS, 4, false));
    for (const m of [-1, 1]) {
      const pts = [1.5, 1.95, 2.45, 3.0, 3.38].map((s) => k.cabinEdge(s).base);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, c = pts[i + 1]!;
        out.push(tube(new THREE.Vector3(m * (a.x + 0.006), a.y + 0.025, a.z), new THREE.Vector3(m * (c.x + 0.006), c.y + 0.025, c.z), 0.008, CHROME, 3, false));
      }
    }

    // Lignes de portes (la porte arrière contourne la roue), poignée avant ; la poignée arrière est cachée dans le montant (on ne la voit pas).
    out.push(k.sideLine([[1.22, 0.36], [1.21, 0.6], [1.24, k.belt(1.24) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.4, 0.3], [2.4, k.belt(2.4) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[2.98, 0.3], [3.0, 0.6], [3.08, 0.74], [3.12, k.belt(3.12) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[2.12, k.belt(2.2) - 0.08], [2.27, k.belt(2.2) - 0.08]], 0.016, TRIM, 0.01));

    // Creux noir au bas des portes, qui remonte à l'arrière, jonc chromé au-dessus.
    out.push(k.sideLine([[1.32, 0.32], [2.0, 0.325], [2.7, 0.34], [2.95, 0.37]], 0.035, "#33353b", 0.009));
    out.push(k.sideLine([[1.45, 0.362], [2.0, 0.366], [2.7, 0.382], [2.93, 0.41]], 0.005, CHROME, 0.013));

    // Feux arrière : la glace rouge, un cœur plus sombre, qui s'enroulent du hayon sur l'aile.
    // Contour sombre (comme les phares) qui détache le feu de la carrosserie, glace rouge vif, cœur sombre et filet clair des diodes.
    const tail = (grow: number): Guide[][] => [
      TAILLAMP.map(([x, t, , s, a], i) => g(x, t + (i > 0 ? grow : 0), s, rearTurn(a))),
      TAILLAMP.map(([x, , b, s, a], i) => g(x, b - (i > 0 ? grow : 0), s, rearTurn(a))),
    ];
    out.push(k.decal(tail(0.012), HOUSING, 0.014, true, 2));
    out.push(k.decal(tail(0), TAIL, 0.02, true, 2));
    const mid = TAILLAMP.slice(1, 6);
    out.push(k.decal([mid.map(([x, t, b, s, a]) => g(x, (t + b) / 2 + 0.006, s, rearTurn(a))), mid.map(([x, t, b, s, a]) => g(x, (t + b) / 2 - 0.016, s, rearTurn(a)))], TAIL_DARK, 0.026, true, 1));
    out.push(k.decal([mid.map(([x, t, , s, a]) => g(x, t - 0.012, s, rearTurn(a))), mid.map(([x, t, , s, a]) => g(x, t - 0.022, s, rearTurn(a)))], "#ff8a6a", 0.028, true, 1));
    // Ligne du pare-chocs en travers du hayon, et ses retours sur les flancs.
    out.push(k.plate(-0.72, 0.72, 0.515, 0.523, 4.0, REAR, DARK, 0.012, 6));

    // Hayon : jonc chromé sous la lunette, plaque, extracteur noir, catadioptres.
    out.push(k.plate(-0.38, 0.38, 0.69, 0.705, 4.02, REAR, CHROME, 0.01, 4));
    out.push(k.plate(-0.26, 0.26, 0.44, 0.55, 4.04, REAR, PLATE, 0.01, 2));
    out.push(k.decal([[0, 0.25, 0.5, 0.62, 0.7].map((x) => g(x, 0.36, 4.0, rearTurn(x > 0.6 ? 30 : 0))), [0, 0.25, 0.5, 0.62, 0.72].map((x) => g(x, 0.22, 4.0, rearTurn(x > 0.6 ? 30 : 0)))], DARK, 0.008));
    out.push(k.decal([[g(0.6, 0.39, 4.0, rearTurn(20)), g(0.7, 0.39, 3.98, rearTurn(40))], [g(0.6, 0.37, 4.0, rearTurn(20)), g(0.7, 0.37, 3.98, rearTurn(40))]], TAIL_DARK, 0.011));

    // Bras sombres des rétroviseurs.
    for (const s of [-1, 1]) out.push(box(0.06, 0.03, 0.06, s * 0.77, 0.97, k.z(1.36), DARK));
    return out;
  },
};

