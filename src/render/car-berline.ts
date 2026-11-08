import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { tube } from "./vehicle-model";

/**
 * Berline (Augusta Préfète, D274) sculptée d'après les photos fournies par l'utilisateur (berline électrique « fastback » des années 2020 : trois-quarts
 * avant, trois-quarts arrière, face) et ses mesures (4,72 × 1,85 × 1,44 m ; empattement de la fiche de conduite gardé, 2,82 m). Côté droit, en s.
 * Ce qui la fait reconnaître : **pas de calandre**, un nez bas, lisse et rond, des phares très fins posés sur les coins ; une simple fente noire en bas
 * du bouclier ; pare-brise immense qui file loin vers l'arrière, toit de verre noir, encadrements de vitres noirs ; lunette très couchée qui tombe sur un
 * coffre court ; feux arrière fins en crochet ; poignées affleurantes.
 */

const LIGHT = "#f5ecd2";
const LED = "#fff6dc";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const TRIM = "#2c2c33";
const TAIL = "#e0442c";
const TAIL_DARK = "#9c2a1c";
const AMBER = "#f1a03a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Phare droit, très fin : [x, haut, bas, s, angle du rayon]. */
const HEAD: readonly (readonly [number, number, number, number, number])[] = [
  [0.45, 0.585, 0.572, 0.06, 5],
  [0.58, 0.605, 0.57, 0.08, 15],
  [0.7, 0.63, 0.578, 0.12, 35],
  [0.8, 0.655, 0.602, 0.19, 60],
  [0.86, 0.68, 0.638, 0.28, 80],
  [0.88, 0.7, 0.688, 0.38, 90],
];

/** Feu arrière droit : une barre fine qui finit en crochet vers le bas sur le coin, puis file sur l'aile. */
const TAILLAMP: readonly (readonly [number, number, number, number, number])[] = [
  [0.4, 0.905, 0.89, 4.64, 0],
  [0.58, 0.915, 0.886, 4.62, 5],
  [0.72, 0.922, 0.86, 4.57, 28],
  [0.82, 0.928, 0.872, 4.5, 62],
  [0.87, 0.934, 0.91, 4.4, 88],
];

export const BERLINE: Sculpt = {
  top: [
    [0, 0.52], [0.05, 0.61], [0.15, 0.67], [0.3, 0.715], [0.5, 0.74], [1.3, 0.805], [2.0, 0.86], [3.0, 0.925], [3.8, 0.97], [4.25, 0.985],
    [4.5, 0.97], [4.62, 0.925], [4.676, 0.83],
  ],
  bottom: [[0, 0.25], [0.05, 0.21], [0.15, 0.19], [0.35, 0.17], [0.6, 0.16], [1.5, 0.15], [3.2, 0.15], [4.3, 0.17], [4.5, 0.2], [4.62, 0.23], [4.676, 0.29]],
  width: [
    [0, 0.56], [0.05, 0.7], [0.15, 0.81], [0.35, 0.88], [0.838, 0.905], [2.2, 0.9], [3.2, 0.905], [3.658, 0.915], [4.2, 0.9], [4.5, 0.85],
    [4.62, 0.78], [4.676, 0.64],
  ],
  cabin: [[1.3, 0, 0.78], [1.8, 1.12, 0.74], [2.35, 1.4, 0.66], [2.9, 1.44, 0.665], [3.4, 1.415, 0.65], [3.85, 1.29, 0.66], [4.25, 0, 0.74]],
  windows: { shield: [1.3, 2.35], rear: [3.4, 4.25], side: [1.3, 3.4], black: [3.4, 3.85], roof: [2.35, 3.4], blackFrame: true },
  arch: 0.4,
  lamps: { head: [0.66, 0.6, 0.1], tail: [0.6, 0.9, 4.62] },

  paint: (k) => {
    // Rétroviseurs couleur caisse, sur la portière.
    const out: THREE.BufferGeometry[] = [];
    for (const m of [-1, 1]) {
      out.push(podLoft([
        { x: m * 0.8, y: 0.9, z: k.z(1.42), w: 0.03, h: 0.035 },
        { x: m * 0.86, y: 0.92, z: k.z(1.47), w: 0.06, h: 0.055 },
        { x: m * 0.86, y: 0.92, z: k.z(1.6), w: 0.05, h: 0.05 },
      ], "#ffffff", 6));
    }
    return out;
  },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares fins : boîtier sombre, glace, filet de diodes ; clignotant ambré à la pointe intérieure.
    const head = (grow: number, inner = 0): Guide[][] => [
      HEAD.map(([x, t, , s, a], i) => g(x, t + grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) - inner, s, frontTurn(a))),
      HEAD.map(([x, , b, s, a], i) => g(x, b - grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) + inner, s, frontTurn(a))),
    ];
    out.push(k.decal(head(0.01), HOUSING, 0.012, true, 2));
    out.push(k.decal(head(0, 0.004), LIGHT, 0.018, true, 2));
    out.push(k.decal([HEAD.slice(1, 5).map(([x, t, , s, a]) => g(x, t - 0.006, s, frontTurn(a))), HEAD.slice(1, 5).map(([x, t, , s, a]) => g(x, t - 0.014, s, frontTurn(a)))], LED, 0.022, true, 1));
    out.push(k.decal([[g(0.5, 0.586, 0.065, frontTurn(8)), g(0.56, 0.59, 0.075, frontTurn(12))], [g(0.5, 0.576, 0.065, frontTurn(8)), g(0.56, 0.576, 0.075, frontTurn(12))]], AMBER, 0.022));

    // Pas de calandre : une fente noire au bas du bouclier, la plaque au-dessus ; une caméra sombre sur l'aile.
    const slot = [0, 0.2, 0.38, 0.5];
    out.push(k.decal([slot.map((x, i) => g(x, i === 3 ? 0.3 : 0.315, 0, FRONT)), slot.map((x, i) => g(x, i === 3 ? 0.285 : 0.265, 0.02, FRONT))], GLOSS, 0.008));
    out.push(k.plate(-0.26, 0.26, 0.345, 0.45, 0, FRONT, PLATE, 0.02, 2));
    out.push(k.decal([[g(0.9, 0.79, 1.02, SIDE), g(0.9, 0.79, 1.07, SIDE)], [g(0.9, 0.76, 1.02, SIDE), g(0.9, 0.76, 1.07, SIDE)]], DARK, 0.01));

    // Flancs : lignes de portes (la porte arrière contourne la roue), poignées affleurantes ; montant central noir.
    const b = k.cabinEdge(2.72);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * b.base.x, b.base.y + 0.02, b.base.z), new THREE.Vector3(m * b.top.x, b.top.y, b.top.z), 0.035, GLOSS, 4, false));
    out.push(k.sideLine([[1.33, 0.32], [1.31, 0.6], [1.35, k.belt(1.35) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.72, 0.24], [2.72, k.belt(2.72) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.2, 0.24], [3.22, 0.62], [3.32, 0.78], [3.38, k.belt(3.38) - 0.015]], 0.005, DARK));
    for (const s of [2.42, 3.1]) out.push(k.sideLine([[s, k.belt(s) - 0.07], [s + 0.13, k.belt(s) - 0.07]], 0.01, TRIM, 0.01));

    // Feux arrière fins en crochet : boîtier sombre, glace rouge, filet clair.
    const tail = (grow: number): Guide[][] => [
      TAILLAMP.map(([x, t, , s, a], i) => g(x, t + (i > 0 ? grow : 0), s, rearTurn(a))),
      TAILLAMP.map(([x, , bo, s, a], i) => g(x, bo - (i > 0 ? grow : 0), s, rearTurn(a))),
    ];
    out.push(k.decal(tail(0.01), HOUSING, 0.014, true, 2));
    out.push(k.decal(tail(0), TAIL, 0.02, true, 2));
    out.push(k.decal([TAILLAMP.slice(1, 4).map(([x, t, , s, a]) => g(x, t - 0.006, s, rearTurn(a))), TAILLAMP.slice(1, 4).map(([x, t, , s, a]) => g(x, t - 0.013, s, rearTurn(a)))], "#ff8a6a", 0.026, true, 1));

    // Coffre : plaque sur le couvercle, ligne du pare-chocs, bas noir avec catadioptres.
    out.push(k.plate(-0.26, 0.26, 0.63, 0.735, 4.66, REAR, PLATE, 0.012, 2));
    out.push(k.plate(-0.74, 0.74, 0.53, 0.538, 4.65, REAR, DARK, 0.012, 6));
    out.push(k.decal([[0, 0.25, 0.5, 0.66, 0.74].map((x) => g(x, 0.36, 4.64, rearTurn(x > 0.6 ? 30 : 0))), [0, 0.25, 0.5, 0.66, 0.76].map((x) => g(x, 0.22, 4.64, rearTurn(x > 0.6 ? 30 : 0)))], DARK, 0.008));
    out.push(k.decal([[g(0.6, 0.38, 4.62, rearTurn(15)), g(0.7, 0.38, 4.58, rearTurn(30))], [g(0.6, 0.365, 4.62, rearTurn(15)), g(0.7, 0.365, 4.58, rearTurn(30))]], TAIL_DARK, 0.012));
    return out;
  },
};
