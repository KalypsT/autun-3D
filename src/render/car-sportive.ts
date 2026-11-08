import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { tube } from "./vehicle-model";

/**
 * Sportive (Augusta Janus, D277) sculptée d'après les photos fournies par l'utilisateur : une berlinette française à moteur central des années 2010
 * (première version : trois-quarts avant, profil, arrière, trois-quarts arrière) ; mesures 4,18 × 1,80 × 1,25 m (empattement de la fiche gardé, 2,60 m :
 * le vrai fait 2,42 m, d'où des porte-à-faux un peu courts). Côté droit, en s.
 * Ce qui la fait reconnaître : capot bas et plongeant, les **quatre feux ronds** de face (deux phares en goutte sur les ailes, cerclés de diodes,
 * et deux feux ronds plus bas, en croix), grande bouche noire basse ; toit en bulle, grande lunette encadrée de noir, vitre de custode en pointe,
 * creux le long du flanc ; à l'arrière, des feux minces en X, une seule sortie trapézoïdale au milieu d'un diffuseur noir ; jantes claires à branches doubles.
 */

const LED = "#fff6dc";
const GLASS = "#e9ecef";
const HOUSING = "#23262c";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#3a3e46";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const TAIL = "#e0442c";
const TAIL_DARK = "#5e1a14";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.sportive`, empattement de la fiche). */
const AXLE_F = 0.778;
const AXLE_R = 3.378;

/** Anneau rond posé sur la caisse (centre x, y ; rayons ; rayon tiré selon `dir`) : 8 segments. */
function ring(k: SculptKit, x: number, y: number, s: number, dir: THREE.Vector3, r0: number, r1: number, color: string, lift: number): THREE.BufferGeometry {
  const at = (r: number): Guide[] => Array.from({ length: 9 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 8, side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    return g(x + side.x * Math.cos(a) * r, y + Math.sin(a) * r, s + side.z * Math.cos(a) * r, dir);
  });
  return k.decal([at(r1), at(r0)], color, lift);
}

/** Disque (rayon r) : un anneau de rayon intérieur presque nul. */
function disc(k: SculptKit, x: number, y: number, s: number, dir: THREE.Vector3, r: number, color: string, lift: number): THREE.BufferGeometry {
  return ring(k, x, y, s, dir, 0.004, r, color, lift);
}

export const SPORTIVE: Sculpt = {
  top: [
    [0, 0.56], [0.05, 0.63], [0.15, 0.68], [0.4, 0.73], [0.778, 0.77], [1.1, 0.8], [1.45, 0.87], [2.0, 0.92], [2.5, 0.96], [3.0, 0.995],
    [3.378, 0.985], [3.7, 0.92], [3.88, 0.85], [4.0, 0.81], [4.1, 0.77], [4.136, 0.67],
  ],
  bottom: [[0, 0.2], [0.05, 0.17], [0.2, 0.15], [0.6, 0.15], [3.6, 0.16], [3.9, 0.2], [4.05, 0.24], [4.136, 0.3]],
  width: [
    [0, 0.55], [0.05, 0.7], [0.15, 0.8], [0.4, 0.875], [0.778, 0.895], [1.2, 0.88], [2.0, 0.86], [2.6, 0.875], [3.378, 0.9], [3.7, 0.88],
    [3.95, 0.83], [4.08, 0.74], [4.136, 0.62],
  ],
  cabin: [[1.45, 0, 0.75], [1.8, 1.08, 0.66], [2.2, 1.235, 0.56], [2.5, 1.25, 0.55], [2.85, 1.22, 0.54], [3.2, 1.12, 0.55], [3.6, 0.97, 0.6], [3.88, 0, 0.66]],
  windows: { shield: [1.45, 2.2], rear: [2.85, 3.88], side: [1.45, 3.2] },
  arch: 0.35,
  lamps: { head: [0.66, 0.62, 0.15], tail: [0.6, 0.72, 4.12] },

  paint: (k) => {
    // Bout de la vitre de custode, en pointe : le haut de la vitre redescend vers la ceinture.
    const top = (s: number): number => k.cabinEdge(s).top.y;
    return [
      k.decal([
        [g(1, top(2.85) + 0.01, 2.85, SIDE), g(1, top(3.2) + 0.01, 3.2, SIDE)],
        [g(1, top(2.85) + 0.004, 2.85, SIDE), g(1, k.cabinEdge(3.2).base.y + 0.03, 3.2, SIDE)],
      ], "#ffffff", 0.004),
      // Rétroviseurs couleur caisse, sur un pied.
      ...[-1, 1].map((m) => podLoft([
        { x: m * 0.76, y: 0.93, z: k.z(1.62), w: 0.02, h: 0.02 },
        { x: m * 0.86, y: 0.96, z: k.z(1.64), w: 0.05, h: 0.045 },
        { x: m * 0.875, y: 0.96, z: k.z(1.78), w: 0.045, h: 0.04 },
      ], "#ffffff", 6)),
    ];
  },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares en goutte sur les ailes : pointe vers l'intérieur, bout arrondi vers l'aile, cerclé de diodes.
    const head = (grow: number): Guide[][] => [
      [g(0.42, 0.655 + grow * 0.3, 0.12, FRONT), g(0.56, 0.675 + grow, 0.12, frontTurn(14)), g(0.68, 0.68 + grow, 0.15, frontTurn(30)), g(0.78, 0.67 + grow, 0.22, frontTurn(52)), g(0.83, 0.645 + grow * 0.5, 0.3, frontTurn(70))],
      [g(0.44, 0.64 - grow * 0.3, 0.12, FRONT), g(0.56, 0.605 - grow, 0.12, frontTurn(14)), g(0.68, 0.585 - grow, 0.15, frontTurn(30)), g(0.78, 0.585 - grow, 0.22, frontTurn(52)), g(0.83, 0.61 - grow * 0.5, 0.3, frontTurn(70))],
    ];
    out.push(k.decal(head(0.012), HOUSING, 0.012, true, 1));
    out.push(k.decal(head(0), "#4a5058", 0.017, true, 1));
    out.push(ring(k, 0.69, 0.63, 0.15, frontTurn(32), 0.026, 0.038, LED, 0.022));
    out.push(disc(k, 0.69, 0.63, 0.15, frontTurn(32), 0.022, GLASS, 0.024));

    // Feux ronds du bas, en croix, au-dessus des coins de la bouche.
    out.push(disc(k, 0.66, 0.43, 0.06, frontTurn(24), 0.075, HOUSING, 0.012));
    out.push(ring(k, 0.66, 0.43, 0.06, frontTurn(24), 0.05, 0.064, LED, 0.018));
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const c = Math.cos(a) * 0.045, sn = Math.sin(a) * 0.045, d = 0.006;
      out.push(k.decal([[g(0.66 - c - d * sn, 0.43 - sn + d * Math.cos(a), 0.06, frontTurn(24)), g(0.66 + c - d * sn, 0.43 + sn + d * Math.cos(a), 0.06, frontTurn(24))], [g(0.66 - c + d * sn, 0.43 - sn - d * Math.cos(a), 0.06, frontTurn(24)), g(0.66 + c + d * sn, 0.43 + sn - d * Math.cos(a), 0.06, frontTurn(24))]], LED, 0.02));
    }

    // Grande bouche noire basse, en trapèze, avec des lames ; plaque au-dessus ; lame avant noire ; fentes verticales aux coins, devant les roues ;
    // emblème neutre (petit losange) sur le capot.
    const bx = [0, 0.2, 0.4, 0.56];
    out.push(k.decal([bx.map((x) => g(x * 0.92, 0.37, 0, FRONT)), bx.map((x) => g(x, 0.29, 0, FRONT)), bx.map((x) => g(x * 0.95, 0.2, 0.02, FRONT))], GLOSS, 0.01, true, 1));
    for (const y of [0.33, 0.28, 0.23]) out.push(k.decal([[0, 0.25, 0.48].map((x) => g(x, y + 0.006, 0, FRONT)), [0, 0.25, 0.48].map((x) => g(x, y - 0.006, 0, FRONT))], MESH, 0.014));
    out.push(k.plate(-0.26, 0.26, 0.38, 0.485, 0, FRONT, PLATE, 0.018, 2));
    out.push(k.decal([[0, 0.4, 0.7].map((x) => g(x, 0.19, 0.02, x > 0.6 ? frontTurn(40) : FRONT)), [0, 0.4, 0.72].map((x) => g(x, 0.155, 0.04, x > 0.6 ? frontTurn(45) : FRONT))], DARK, 0.016));
    out.push(k.decal([
      [g(0.82, 0.47, 0.18, frontTurn(62)), g(0.86, 0.47, 0.3, frontTurn(76))],
      [g(0.81, 0.26, 0.16, frontTurn(60)), g(0.86, 0.26, 0.3, frontTurn(76))],
    ], GLOSS, 0.012, true, 1));
    out.push(k.decal([[g(-0.025, 0.6, 0.1, FRONT), g(0, 0.62, 0.1, FRONT), g(0.025, 0.6, 0.1, FRONT)], [g(-0.025, 0.6, 0.1, FRONT), g(0, 0.575, 0.1, FRONT), g(0.025, 0.6, 0.1, FRONT)]], CHROME, 0.016, false));

    // Flancs : creux le long des portes (trait sombre), ligne de porte, poignée affleurante, bas de caisse noir ; montant noir avant la custode.
    out.push(k.sideLine([[AXLE_F + 0.42, 0.42], [1.8, 0.45], [2.4, 0.52], [2.9, 0.62], [AXLE_R - 0.4, 0.66]], 0.004, TRIM, 0.009));
    out.push(k.sideLine([[1.42, 0.3], [1.4, 0.6], [1.46, k.belt(1.46) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.72, 0.24], [2.74, 0.6], [2.8, k.belt(2.8) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[2.38, k.belt(2.38) - 0.11], [2.52, k.belt(2.52) - 0.11]], 0.011, TRIM, 0.01));
    out.push(k.sideLine([[AXLE_F + 0.42, 0.205], [2.0, 0.2], [AXLE_R - 0.42, 0.205]], 0.025, DARK, 0.009));
    const e = k.cabinEdge(2.82);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.025, GLOSS, 4, false));
    // Lunette encadrée de noir : un filet noir sur ses bords.
    for (const m of [-1, 1]) {
      const pts = [2.86, 3.2, 3.6, 3.86].map((s) => k.cabinEdge(s).roof);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        out.push(tube(new THREE.Vector3(m * (a.x + 0.004), a.y + 0.004, a.z), new THREE.Vector3(m * (b.x + 0.004), b.y + 0.004, b.z), 0.018, GLOSS, 3, false));
      }
    }

    // Arrière : feux minces et sombres, en X rouge ; plaque sur le bouclier ; diffuseur noir et une seule sortie trapézoïdale au milieu ; catadioptres.
    const tail = (grow: number): Guide[][] => [
      [g(0.34, 0.74 + grow, 4.12, REAR), g(0.52, 0.75 + grow, 4.11, rearTurn(8)), g(0.68, 0.75 + grow, 4.08, rearTurn(25)), g(0.8, 0.74 + grow, 4.0, rearTurn(55))],
      [g(0.36, 0.705 - grow, 4.12, REAR), g(0.52, 0.7 - grow, 4.11, rearTurn(8)), g(0.68, 0.7 - grow, 4.08, rearTurn(25)), g(0.8, 0.715 - grow, 4.0, rearTurn(55))],
    ];
    out.push(k.decal(tail(0.01), HOUSING, 0.014, true, 1));
    out.push(k.decal(tail(0), TAIL_DARK, 0.02, true, 1));
    for (const [x, s, a] of [[0.47, 4.115, 5], [0.62, 4.095, 16]] as const) {
      for (const sg of [1, -1]) {
        out.push(k.decal([[g(x - 0.05, 0.725 + sg * 0.018, s, rearTurn(a)), g(x + 0.05, 0.725 - sg * 0.018, s, rearTurn(a))], [g(x - 0.05, 0.725 + sg * 0.018 - 0.008, s, rearTurn(a)), g(x + 0.05, 0.725 - sg * 0.018 - 0.008, s, rearTurn(a))]], TAIL, 0.026));
      }
    }
    out.push(k.plate(-0.26, 0.26, 0.47, 0.575, 4.14, REAR, PLATE, 0.014, 2));
    out.push(k.decal([[0, 0.3, 0.6, 0.74].map((x) => g(x, 0.37, 4.12, x > 0.6 ? rearTurn(35) : REAR)), [0, 0.3, 0.6, 0.76].map((x) => g(x, 0.2, 4.1, x > 0.6 ? rearTurn(40) : REAR))], DARK, 0.01, true, 1));
    for (const x of [0.2, 0.32, 0.44]) out.push(k.decal([[g(x, 0.34, 4.13, REAR), g(x + 0.012, 0.34, 4.13, REAR)], [g(x, 0.2, 4.11, REAR), g(x + 0.012, 0.2, 4.11, REAR)]], TRIM, 0.016));
    out.push(k.decal([[g(-0.1, 0.33, 4.13, REAR), g(0.1, 0.33, 4.13, REAR)], [g(-0.08, 0.26, 4.13, REAR), g(0.08, 0.26, 4.13, REAR)]], CHROME, 0.02, false));
    out.push(k.decal([[g(-0.075, 0.322, 4.13, REAR), g(0.075, 0.322, 4.13, REAR)], [g(-0.06, 0.27, 4.13, REAR), g(0.06, 0.27, 4.13, REAR)]], GLOSS, 0.024, false));
    out.push(k.decal([[g(0.66, 0.4, 4.07, rearTurn(30)), g(0.74, 0.4, 4.03, rearTurn(45))], [g(0.66, 0.38, 4.07, rearTurn(30)), g(0.74, 0.38, 4.03, rearTurn(45))]], TAIL, 0.012));
    return out;
  },
};
