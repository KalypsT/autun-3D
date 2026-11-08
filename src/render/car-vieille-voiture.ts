import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { tube } from "./vehicle-model";

/**
 * Vieille voiture (Éduen Pétrolette, D278) sculptée d'après les photos fournies par l'utilisateur : une berline française cinq portes des années 1980,
 * première version (1982-1986 : trois-quarts avant, trois-quarts arrière, profil) ; mesures 4,23 × 1,66 × 1,36 m (empattement de la fiche gardé,
 * 2,55 m : la vraie fait 2,655 m, d'où des porte-à-faux un peu longs). Côté droit, en s.
 * Ce qui la fait reconnaître : lignes au cordeau (flancs droits, épaule vive), long capot plongeant qui finit en lame au-dessus de phares
 * rectangulaires, mince calandre noire, emblème décalé à gauche ; gros boucliers gris foncé avec les clignotants orange aux coins ; jonc noir
 * qui fait le tour de la caisse ; roue arrière à demi cachée par un carénage ; custode noire en triangle au-dessus d'ouïes ; grande lunette plate
 * qui finit sur une lèvre noire, malle en coin, feux rectangulaires aux angles ; rétroviseurs noirs triangulaires.
 */

const LIGHT = "#f2ead2";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const BUMPER = "#3b3e44";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const TAIL = "#d8402a";
const AMBER = "#f0962e";
const REVERSE = "#e9e6dc";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES["vieille-voiture"]`, empattement de la fiche). */
const AXLE_F = 0.908;
const AXLE_R = 3.458;

/** Bout de la caisse en s (longueur moins les deux écarts du nez). */
const END = 4.186;

export const VIEILLE_VOITURE: Sculpt = {
  top: [
    [0, 0.5], [0.06, 0.69], [0.13, 0.725], [0.5, 0.765], [AXLE_F, 0.8], [1.3, 0.855], [1.8, 0.885], [2.5, 0.9], [3.1, 0.915], [3.6, 0.94],
    [4.08, 0.965], [4.15, 0.96], [END, 0.88],
  ],
  bottom: [[0, 0.3], [0.04, 0.24], [0.15, 0.22], [0.5, 0.21], [1.3, 0.2], [3.0, 0.2], [3.9, 0.22], [4.1, 0.25], [END, 0.3]],
  width: [
    [0, 0.64], [0.03, 0.74], [0.1, 0.805], [0.3, 0.825], [AXLE_F, 0.83], [1.4, 0.83], [2.4, 0.828], [3.0, 0.832], [AXLE_R, 0.845], [3.85, 0.84],
    [4.0, 0.83], [4.12, 0.8], [END, 0.74],
  ],
  // Flancs droits et épaule vive : la caisse au cordeau des années 1980.
  section: [[0.55, 0], [0.93, 0.02], [0.995, 0.15], [1, 0.55], [0.985, 0.88], [0.94, 0.975], [0.6, 1]],
  cabin: [
    [1.3, 0, 0.72], [1.62, 1.1, 0.66], [1.95, 1.33, 0.61], [2.4, 1.36, 0.6], [3.05, 1.345, 0.6], [3.3, 1.31, 0.6], [3.7, 1.13, 0.63], [4.08, 0, 0.69],
  ],
  windows: { shield: [1.3, 1.95], rear: [3.3, 4.08], side: [1.3, 3.05], black: [3.05, 4.08], blackFrame: true },
  arch: 0.36,
  rearSpat: 0.46,
  lamps: { head: [0.56, 0.62, 0.03], tail: [0.66, 0.69, 4.17] },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];

    // Phares rectangulaires sous la lame du capot, sur la face inclinée ; une barrette sombre sépare le feu de route.
    const head = (grow: number): Guide[][] => [
      [g(0.36 - grow, 0.665 + grow, 0.04, FRONT), g(0.55, 0.665 + grow, 0.04, FRONT), g(0.7 + grow, 0.665 + grow, 0.05, frontTurn(25))],
      [g(0.36 - grow, 0.565 - grow, 0.02, FRONT), g(0.55, 0.565 - grow, 0.02, FRONT), g(0.7 + grow, 0.565 - grow, 0.03, frontTurn(25))],
    ];
    out.push(k.decal(head(0.012), HOUSING, 0.012, true, 1));
    out.push(k.decal(head(0), LIGHT, 0.018, true, 1));
    out.push(k.decal([[g(0.47, 0.665, 0.04, FRONT), g(0.482, 0.665, 0.04, FRONT)], [g(0.47, 0.565, 0.02, FRONT), g(0.482, 0.565, 0.02, FRONT)]], HOUSING, 0.022));

    // Mince calandre noire entre les phares, deux lames ; emblème neutre (losange chromé) décalé à gauche.
    out.push(k.decal([[g(0, 0.66, 0.04, FRONT), g(0.17, 0.66, 0.04, FRONT), g(0.33, 0.66, 0.04, FRONT)], [g(0, 0.575, 0.02, FRONT), g(0.17, 0.575, 0.02, FRONT), g(0.33, 0.575, 0.02, FRONT)]], GLOSS, 0.012));
    for (const y of [0.635, 0.6]) out.push(k.decal([[g(0, y + 0.005, 0.03, FRONT), g(0.32, y + 0.005, 0.03, FRONT)], [g(0, y - 0.005, 0.03, FRONT), g(0.32, y - 0.005, 0.03, FRONT)]], TRIM, 0.016));
    out.push(k.decal([[g(-0.25, 0.618, 0.03, FRONT), g(-0.205, 0.636, 0.03, FRONT), g(-0.16, 0.618, 0.03, FRONT)], [g(-0.25, 0.618, 0.03, FRONT), g(-0.205, 0.6, 0.03, FRONT), g(-0.16, 0.618, 0.03, FRONT)]], CHROME, 0.022, false));

    // Gros bouclier avant gris foncé, qui fait le tour des coins jusque devant les roues ; clignotants orange aux coins ; prise d'air et plaque.
    const bumperFront = (y: number): Guide[] => [
      g(0, y, 0, FRONT), g(0.3, y, 0, FRONT), g(0.55, y, 0, FRONT), g(0.72, y, 0.03, frontTurn(35)), g(0.8, y, 0.1, frontTurn(65)),
      g(1, y, 0.22, SIDE), g(1, y, 0.36, SIDE), g(1, y, 0.48, SIDE),
    ];
    out.push(k.decal([bumperFront(0.5), bumperFront(0.39), bumperFront(0.27)], BUMPER, 0.01, true, 1));
    out.push(k.decal([
      [g(0.7, 0.485, 0.03, frontTurn(35)), g(0.79, 0.485, 0.09, frontTurn(62)), g(1, 0.485, 0.17, SIDE)],
      [g(0.7, 0.425, 0.03, frontTurn(35)), g(0.79, 0.425, 0.09, frontTurn(62)), g(1, 0.425, 0.17, SIDE)],
    ], AMBER, 0.016, true, 1));
    out.push(k.decal([[g(0, 0.345, 0, FRONT), g(0.22, 0.345, 0, FRONT), g(0.42, 0.345, 0, FRONT)], [g(0, 0.3, 0, FRONT), g(0.22, 0.3, 0, FRONT), g(0.42, 0.3, 0, FRONT)]], GLOSS, 0.016));
    out.push(k.plate(-0.26, 0.26, 0.37, 0.475, 0, FRONT, PLATE, 0.018, 2));

    // Flancs : jonc noir qui file des portes jusque sur le carénage arrière, bas de caisse sombre, lignes de portes, poignées ;
    // montant central noir ; ouïes sous la custode.
    out.push(k.sideLine([[1.22, 0.55], [2.2, 0.552], [3.2, 0.555], [3.95, 0.555]], 0.018, GLOSS, 0.01));
    out.push(k.sideLine([[1.33, 0.27], [2.2, 0.27], [3.05, 0.27]], 0.035, BUMPER, 0.009));
    out.push(k.sideLine([[1.32, 0.33], [1.31, 0.62], [1.36, k.belt(1.36) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.45, 0.32], [2.45, k.belt(2.45) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.06, 0.32], [3.06, 0.62], [3.09, k.belt(3.09) - 0.015]], 0.005, DARK));
    for (const s of [2.2, 2.84]) out.push(k.sideLine([[s, k.belt(s) - 0.1], [s + 0.12, k.belt(s + 0.12) - 0.1]], 0.014, TRIM, 0.01));
    const b = k.cabinEdge(2.45);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * b.base.x, b.base.y + 0.02, b.base.z), new THREE.Vector3(m * b.top.x, b.top.y, b.top.z), 0.035, GLOSS, 4, false));
    for (let i = 0; i < 5; i++) {
      const y = 0.855 + i * 0.016, s0 = 3.42 + i * 0.025;
      out.push(k.sideLine([[s0, y], [3.84, y + 0.006]], 0.004, GLOSS, 0.01));
    }

    // Arrière : lèvre noire au pied de la lunette, feux rectangulaires aux angles (orange et blanc en haut, rouge en bas), plaque, serrure.
    out.push(k.plate(-0.72, 0.72, 0.9, 0.95, END, REAR, GLOSS, 0.012, 6));
    const tail = (y0: number, y1: number, x0: number, grow: number): Guide[][] => {
      const row = (y: number): Guide[] => [g(x0 - grow, y, END, REAR), g(0.66, y, 4.17, rearTurn(15)), g(0.77, y, 4.14, rearTurn(45)), g(0.83 + grow, y, 4.07, rearTurn(78))];
      return [row(y1 + grow), row(y0 - grow)];
    };
    out.push(k.decal(tail(0.6, 0.775, 0.5, 0.012), HOUSING, 0.012, true, 1));
    out.push(k.decal(tail(0.6, 0.71, 0.5, 0), TAIL, 0.018, true, 1));
    out.push(k.decal(tail(0.72, 0.775, 0.6, 0), AMBER, 0.018, true, 1));
    out.push(k.decal([[g(0.5, 0.775, END, REAR), g(0.58, 0.775, END, REAR)], [g(0.5, 0.72, END, REAR), g(0.58, 0.72, END, REAR)]], REVERSE, 0.02));
    out.push(k.plate(-0.26, 0.26, 0.6, 0.71, END, REAR, PLATE, 0.014, 2));
    out.push(k.plate(-0.03, 0.03, 0.74, 0.775, END, REAR, DARK, 0.014));

    // Gros bouclier arrière gris foncé, rayé de noir, qui revient sur les flancs jusque derrière les roues.
    const bumperRear = (y: number): Guide[] => [
      g(0, y, END, REAR), g(0.3, y, END, REAR), g(0.55, y, END, REAR), g(0.72, y, 4.15, rearTurn(35)), g(0.8, y, 4.09, rearTurn(65)),
      g(1, y, 4.0, SIDE), g(1, y, 3.9, SIDE),
    ];
    out.push(k.decal([bumperRear(0.53), bumperRear(0.4), bumperRear(0.27)], BUMPER, 0.01, true, 1));
    out.push(k.decal([bumperRear(0.46), bumperRear(0.445)], GLOSS, 0.016, true, 1));

    // Rétroviseurs noirs triangulaires, au coin de la vitre avant.
    for (const m of [-1, 1]) {
      out.push(podLoft([
        { x: m * 0.73, y: 0.97, z: k.z(1.44), w: 0.03, h: 0.05 },
        { x: m * 0.815, y: 0.985, z: k.z(1.46), w: 0.03, h: 0.075 },
        { x: m * 0.83, y: 0.985, z: k.z(1.53), w: 0.012, h: 0.03 },
      ], DARK, 4));
    }
    return out;
  },
};
