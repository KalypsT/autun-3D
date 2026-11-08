import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, rearTurn, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { box, paint } from "./vehicle-model";

/**
 * Camionnette (Couhard Mulet, D279) sculptée d'après les photos fournies par l'utilisateur : un fourgon compact français, version restylée de 2021
 * (trois-quarts avant, face, profil ; l'arrière d'après deux trois-quarts arrière) ; mesures 5,08 × 1,96 × 1,97 m (empattement de la fiche gardé,
 * 3,00 m : le vrai fait 3,10 m). Côté droit, en s.
 * Ce qui le fait reconnaître : nez court et incliné, phares en C qui s'étirent sur l'aile, reliés à l'emblème par un jonc chromé, calandre noire
 * en trapèze à lames ; gros bouclier noir avec sa grille basse et ses poches d'angle ; pare-brise très couché ; vitre de porte qui plonge vers le
 * rétroviseur ; flancs d'aplomb, porte coulissante et son rail, emboutis de la tôle, nervure qui court sous la ceinture, bas de caisse noir ;
 * derrière, deux portes battantes entre des montants noirs qui portent des feux verticaux, troisième feu stop, bouclier-marchepied noir ;
 * grands rétroviseurs noirs sur bras.
 */

const LENS = "#4a5058";
const LED = "#fff6dc";
const HOUSING = "#23262c";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const BLACK = "#26282d";
const MESH = "#3a3e46";
const CREASE = "#9a9ea4";
const CHROME = "#c9ccd0";
const TAIL = "#d8402a";
const TAIL_DARK = "#8e2418";
const REVERSE = "#e9e6dc";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.camionnette`, empattement de la fiche). */
const AXLE_F = 0.978;
const AXLE_R = 3.978;

/** Bout de la caisse en s (longueur moins les deux écarts du nez). */
const END = 5.036;

/** Montant noir d'un angle arrière, sur la face arrière et le bout du flanc, de y0 à y1. */
function cornerPost(k: SculptKit, y0: number, y1: number, color: string, lift: number, inner = 0.8): THREE.BufferGeometry {
  const row = (y: number): Guide[] => [g(inner, y, END, REAR), g(0.9, y, END - 0.01, rearTurn(25)), g(0.95, y, END - 0.04, rearTurn(60)), g(1, y, END - 0.1, SIDE)];
  return k.decal([row(y1), row((y0 + y1) / 2), row(y0)], color, lift, true, 1);
}

export const CAMIONNETTE: Sculpt = {
  top: [
    [0, 0.6], [0.045, 0.72], [0.09, 0.9], [0.15, 1.08], [0.22, 1.17], [0.32, 1.21], [0.5, 1.24], [0.82, 1.28], [1.05, 1.3], [1.3, 1.21], [1.7, 1.27], [2.22, 1.36],
    [4.9, 1.38], [END, 1.36],
  ],
  bottom: [[0, 0.26], [0.04, 0.2], [0.15, 0.19], [0.6, 0.22], [1.7, 0.28], [2.22, 0.28], [4.5, 0.3], [4.9, 0.31], [END, 0.34]],
  width: [
    [0, 0.86], [0.04, 0.9], [0.1, 0.94], [0.25, 0.965], [0.6, 0.975], [AXLE_F, 0.978], [AXLE_R, 0.978], [4.93, 0.975], [5.0, 0.96], [END, 0.93],
  ],
  // Flancs d'aplomb, épaule à peine arrondie : un fourgon.
  section: [[0.6, 0], [0.95, 0.02], [0.995, 0.12], [1, 0.5], [1, 0.9], [0.99, 0.97], [0.96, 0.995], [0.8, 1]],
  cabinFoot: 0.965,
  cabin: [
    [1.05, 0, 0.84], [1.4, 1.54, 0.84], [1.7, 1.77, 0.86], [1.96, 1.95, 0.88], [2.22, 1.967, 0.89], [4.95, 1.967, 0.9], [5.0, 1.955, 0.89], [END, 0, 0.88],
  ],
  windows: { shield: [1.05, 1.96], rear: [END, END], side: [1.05, 2.22] },
  arch: 0.4,
  lamps: { head: [0.78, 1.07, 0.12], tail: [0.93, 1.3, 5.02] },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];

    // Phares en C : boîtier sombre qui s'étire de la face sur l'aile, glace claire, filet de diodes le long du haut et du bout.
    const head = (grow: number): Guide[][] => [
      [g(0.6 - grow, 1.08 + grow * 0.5, 0.1, FRONT), g(0.75, 1.11 + grow, 0.1, frontTurn(15)), g(0.88, 1.13 + grow, 0.15, frontTurn(40)), g(0.95, 1.14 + grow, 0.3, frontTurn(70)), g(1, 1.15 + grow * 0.5, 0.55, SIDE)],
      [g(0.62 - grow, 1.03 - grow * 0.5, 0.1, FRONT), g(0.75, 0.97 - grow, 0.1, frontTurn(15)), g(0.88, 0.95 - grow, 0.15, frontTurn(40)), g(0.95, 1.0 - grow, 0.3, frontTurn(70)), g(1, 1.11 - grow * 0.5, 0.55, SIDE)],
    ];
    out.push(k.decal(head(0.014), HOUSING, 0.012, true, 1));
    out.push(k.decal(head(0), LENS, 0.018, true, 1));
    out.push(k.decal([
      [g(0.62, 1.075, 0.1, FRONT), g(0.75, 1.105, 0.1, frontTurn(15)), g(0.88, 1.125, 0.15, frontTurn(40)), g(0.95, 1.135, 0.3, frontTurn(70))],
      [g(0.62, 1.06, 0.1, FRONT), g(0.75, 1.088, 0.1, frontTurn(15)), g(0.88, 1.105, 0.15, frontTurn(40)), g(0.95, 1.11, 0.3, frontTurn(70))],
    ], LED, 0.024, true, 1));

    // Calandre noire en trapèze, quatre lames ; jonc chromé de l'emblème aux phares ; emblème neutre (disque chromé).
    const gx = (y: number): number => 0.5 + ((y - 0.69) / 0.35) * 0.14;
    out.push(k.decal([[0, 0.3, 0.64].map((x) => g(x, 1.04, 0.1, FRONT)), [0, 0.3, 0.57].map((x) => g(x, 0.865, 0.1, FRONT)), [0, 0.3, 0.5].map((x) => g(x, 0.69, 0.1, FRONT))], GLOSS, 0.012, true, 1));
    for (const y of [0.98, 0.91, 0.84, 0.77]) out.push(k.decal([[g(0, y + 0.01, 0.1, FRONT), g(gx(y) - 0.03, y + 0.01, 0.1, FRONT)], [g(0, y - 0.01, 0.1, FRONT), g(gx(y) - 0.03, y - 0.01, 0.1, FRONT)]], MESH, 0.016));
    out.push(k.decal([[g(0, 1.085, 0.1, FRONT), g(0.3, 1.085, 0.1, FRONT), g(0.62, 1.085, 0.1, FRONT)], [g(0, 1.055, 0.1, FRONT), g(0.3, 1.055, 0.1, FRONT), g(0.62, 1.055, 0.1, FRONT)]], CHROME, 0.016));
    const badge = k.project(g(0, 1.0, 0.1, FRONT), 0.01).p;
    out.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 8).rotateX(Math.PI / 2).translate(badge.x, badge.y, badge.z), CHROME));

    // Gros bouclier noir qui revient sur les flancs jusque devant les roues ; grille basse à lames, plaque, poches d'angle et leurs feux de jour.
    const bumper = (y: number): Guide[] => [
      g(0, y, 0, FRONT), g(0.4, y, 0, FRONT), g(0.7, y, 0.01, FRONT), g(0.78, y, 0.02, frontTurn(25)), g(0.86, y, 0.05, frontTurn(40)),
      g(0.91, y, 0.09, frontTurn(55)), g(0.95, y, 0.15, frontTurn(70)), g(0.98, y, 0.22, frontTurn(82)), g(1, y, 0.32, SIDE), g(1, y, 0.48, SIDE),
    ];
    out.push(k.decal([bumper(0.6), bumper(0.42), bumper(0.27)], BLACK, 0.01, true, 1));
    out.push(k.decal([[0, 0.3, 0.58].map((x) => g(x, 0.36, 0, FRONT)), [0, 0.3, 0.6].map((x) => g(x, 0.27, 0, FRONT))], GLOSS, 0.016));
    for (const y of [0.335, 0.3]) out.push(k.decal([[g(0, y + 0.006, 0, FRONT), g(0.56, y + 0.006, 0, FRONT)], [g(0, y - 0.006, 0, FRONT), g(0.56, y - 0.006, 0, FRONT)]], MESH, 0.02));
    out.push(k.plate(-0.3, 0.3, 0.42, 0.54, 0, FRONT, PLATE, 0.018, 2));
    out.push(k.decal([[g(0.68, 0.53, 0.01, FRONT), g(0.86, 0.5, 0.05, frontTurn(40))], [g(0.7, 0.36, 0.01, FRONT), g(0.86, 0.33, 0.05, frontTurn(40))]], GLOSS, 0.016));
    out.push(k.decal([[g(0.72, 0.4, 0.01, FRONT), g(0.84, 0.37, 0.05, frontTurn(40))], [g(0.72, 0.38, 0.01, FRONT), g(0.84, 0.35, 0.05, frontTurn(40))]], LED, 0.022));

    // Flancs : bas de caisse noir et son jonc alu, nervure sous la ceinture, lignes des portes (porte coulissante entre les deux montants),
    // poignée, rail de la porte coulissante, emboutis de la tôle.
    out.push(k.sideLine([[AXLE_F + 0.46, 0.39], [2.4, 0.38], [AXLE_R - 0.46, 0.38]], 0.075, BLACK, 0.01));
    out.push(k.sideLine([[AXLE_F + 0.5, 0.31], [2.4, 0.305], [AXLE_R - 0.5, 0.305]], 0.008, CHROME, 0.014));
    out.push(k.sideLine([[1.5, 0.9], [1.7, 0.82], [1.95, 0.74], [2.6, 0.735], [3.45, 0.74]], 0.004, CREASE, 0.009));
    out.push(k.sideLine([[1.18, 0.8], [1.16, 1.0], [1.14, k.belt(1.14) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.3, 0.47], [2.3, 1.2], [2.3, 1.88]], 0.005, DARK));
    out.push(k.sideLine([[3.6, 0.62], [3.6, 1.2], [3.6, 1.88]], 0.005, DARK));
    out.push(k.sideLine([[2.02, 1.03], [2.2, 1.03]], 0.014, GLOSS, 0.012));
    out.push(k.sideLine([[3.6, 1.27], [4.3, 1.27], [4.86, 1.28]], 0.009, DARK, 0.011));
    out.push(k.sideLine([[2.5, 1.87], [3.6, 1.875], [4.62, 1.875], [4.68, 1.84], [4.7, 1.6], [4.68, 1.33]], 0.004, CREASE, 0.009));

    // Arrière : montants noirs aux angles, feux verticaux dedans, troisième feu stop, joint des deux portes, poignée, plaque dans son logement,
    // bouclier-marchepied noir qui revient sur les flancs, catadioptres.
    out.push(cornerPost(k, 0.55, 1.93, BLACK, 0.01));
    const tail = (y0: number, y1: number, color: string, lift: number): THREE.BufferGeometry => {
      const row = (y: number): Guide[] => [g(0.84, y, END, REAR), g(0.9, y, END - 0.01, rearTurn(25)), g(0.95, y, END - 0.04, rearTurn(60)), g(1, y, END - 0.08, SIDE)];
      return k.decal([row(y1), row(y0)], color, lift, true, 1);
    };
    out.push(tail(1.06, 1.6, TAIL, 0.018));
    out.push(tail(1.06, 1.17, TAIL_DARK, 0.022));
    out.push(tail(1.25, 1.36, REVERSE, 0.022));
    out.push(k.plate(-0.1, 0.1, 1.885, 1.92, END, REAR, TAIL, 0.014));
    out.push(k.plate(-0.006, 0.006, 0.6, 1.9, END, REAR, DARK, 0.012));
    out.push(k.plate(0.08, 0.26, 1.13, 1.16, END, REAR, GLOSS, 0.014));
    out.push(k.plate(-0.3, 0.3, 0.62, 0.79, END, REAR, BLACK, 0.012, 2));
    out.push(k.plate(-0.26, 0.26, 0.64, 0.75, END, REAR, PLATE, 0.018, 2));
    const back = (y: number): Guide[] => [
      g(0, y, END, REAR), g(0.4, y, END, REAR), g(0.8, y, END, REAR), g(0.9, y, END - 0.01, rearTurn(25)), g(0.95, y, END - 0.04, rearTurn(60)),
      g(1, y, END - 0.15, SIDE), g(1, y, 4.62, SIDE), g(1, y, AXLE_R + 0.48, SIDE),
    ];
    out.push(k.decal([back(0.59), back(0.45), back(0.33)], BLACK, 0.01));
    out.push(k.plate(-0.82, 0.82, 0.56, 0.59, END, REAR, MESH, 0.016, 4));
    for (const m of [-1, 1]) out.push(k.plate(m * 0.88 - 0.03, m * 0.88 + 0.03, 0.42, 0.5, END, REAR, TAIL, 0.016));
    return out;
  },

  // Grands rétroviseurs noirs sur bras, au pied du montant : 2,22 m d'un bord à l'autre (à part : ils débordent du gabarit, D279).
  mirrors: (k) => [-1, 1].flatMap((m) => [
    box(0.16, 0.05, 0.06, m * 0.97, 1.33, k.z(1.3), DARK),
    box(0.1, 0.24, 0.12, m * 1.06, 1.43, k.z(1.3), DARK),
  ]),
};
