import * as THREE from "three";
import { DOWN, FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Supercar des années 1980 (Augusta Sacrovir, D292) sculptée d'après les photos fournies par l'utilisateur : une supercar italienne à V8 biturbo
 * central de la fin des années 1980, version de route (trois-quarts avant, profil en mouvement, trois-quarts arrière, arrière de face ; deux photos
 * de la version course n'ont servi qu'aux volumes). Mesures 4,36 × 1,97 × 1,12 m, empattement réel (2,45 m). Côté droit, en s.
 * Ce qui la fait reconnaître : un coin bas et anguleux, nez pointu avec phares fixes sous des glaces claires aux coins et grande bouche noire basse,
 * capot à prises NACA ; pare-brise très incliné, petite cabine, longue poupe en pente douce dont le capot moteur en plexiglas est **tout en
 * persiennes** ; grand aileron couleur caisse porté par les ailes arrière ; fine ligne noire tout autour de la caisse ; prise d'air sur le haut de
 * l'aile arrière, ouïes verticales derrière la roue ; à l'arrière, **quatre feux ronds** dans un bandeau noir, trois sorties au centre du bouclier.
 */

const LENS = "#d9dde0";
const AMBER = "#e8a33c";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#33363c";
const PLEXI = "#c3c8cc";
const CHROME = "#c9ccd0";
const TAIL = "#d8352a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.sacrovir`, empattement de la fiche). */
const AXLE_F = 0.938;
const AXLE_R = 3.388;
/** Bout de la caisse en s (longueur moins les deux écarts du nez et de la poupe). */
const END = 4.316;

/** Anneau rond posé sur la caisse (centre x, y ; rayons ; rayon tiré selon `dir`) : 10 segments. */
function ring(k: SculptKit, x: number, y: number, s: number, dir: THREE.Vector3, r0: number, r1: number, color: string, lift: number): THREE.BufferGeometry {
  const at = (r: number): Guide[] => Array.from({ length: 11 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 10, side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    return g(x + side.x * Math.cos(a) * r, y + Math.sin(a) * r, s + side.z * Math.cos(a) * r, dir);
  });
  return k.decal([at(r1), at(r0)], color, lift);
}

export const SACROVIR: Sculpt = {
  top: [
    [0, 0.36], [0.05, 0.42], [0.2, 0.48], [0.5, 0.57], [AXLE_F, 0.73], [1.42, 0.72], [2.0, 0.73], [2.6, 0.77], [3.0, 0.82], [AXLE_R, 0.86],
    [3.9, 0.87], [4.15, 0.87], [4.27, 0.85], [END, 0.8],
  ],
  bottom: [[0, 0.1], [0.05, 0.09], [0.5, 0.11], [1.42, 0.12], [3.0, 0.13], [4.15, 0.18], [END, 0.2]],
  width: [
    [0, 0.6], [0.05, 0.75], [0.2, 0.85], [0.5, 0.92], [AXLE_F, 0.95], [1.42, 0.94], [2.0, 0.94], [2.6, 0.965], [AXLE_R, 0.985], [3.9, 0.98],
    [4.15, 0.97], [END, 0.94],
  ],
  cabin: [[1.42, 0, 0.8], [1.75, 0.95, 0.68], [2.05, 1.115, 0.58], [2.55, 1.11, 0.56], [3.0, 1.03, 0.57], [3.5, 0.96, 0.6], [3.95, 0.9, 0.62], [4.15, 0, 0.62]],
  windows: { shield: [1.42, 2.05], rear: [2.55, 3.0], side: [1.42, 2.55] },
  arch: 0.36,
  lamps: { head: [0.68, 0.47, 0.2], tail: [0.68, 0.63, END] },

  paint: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Grand aileron porté par les ailes arrière : le plan, et de chaque côté une dérive qui prolonge l'aile jusqu'à lui.
    out.push(box(1.9, 0.035, 0.3, 0, 1.07, k.z(4.16), "#ffffff"));
    for (const m of [-1, 1]) out.push(box(0.07, 0.22, 0.42, m * 0.93, 0.97, k.z(4.08), "#ffffff"));
    // Rétroviseurs couleur caisse, sur un pied, en haut de la porte.
    for (const m of [-1, 1]) {
      out.push(paint(podLoft([
        { x: m * 0.8, y: 0.77, z: k.z(1.6), w: 0.02, h: 0.02 },
        { x: m * 0.9, y: 0.83, z: k.z(1.62), w: 0.02, h: 0.02 },
        { x: m * 0.93, y: 0.85, z: k.z(1.56), w: 0.05, h: 0.045 },
        { x: m * 0.93, y: 0.85, z: k.z(1.7), w: 0.045, h: 0.04 },
      ], "#ffffff", 5), "#ffffff"));
    }
    return out;
  },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];

    // Avant : phares fixes sous une glace claire aux coins (boîtier sombre, deux feux : blanc, orange), traits des phares escamotables sur le capot.
    const cover = (grow: number): Guide[][] => [
      [g(0.5 - grow, 0.505 + grow, 0.2, frontTurn(10)), g(0.68, 0.51 + grow, 0.2, frontTurn(22)), g(0.86 + grow, 0.49 + grow, 0.3, frontTurn(55))],
      [g(0.52 - grow, 0.43 - grow, 0.1, frontTurn(10)), g(0.7, 0.43 - grow, 0.12, frontTurn(24)), g(0.88 + grow, 0.43 - grow, 0.22, frontTurn(60))],
    ];
    out.push(k.decal(cover(0.012), GLOSS, 0.01, true, 2));
    out.push(k.decal(cover(0), HOUSING, 0.015, true, 2));
    out.push(ring(k, 0.6, 0.468, 0.15, frontTurn(14), 0.004, 0.032, LENS, 0.02));
    out.push(ring(k, 0.74, 0.468, 0.18, frontTurn(30), 0.004, 0.03, AMBER, 0.02));
    for (const [a, b] of [[0.42, 0.44], [0.78, 0.8]] as const) {
      out.push(k.decal([[g(a, 2, 0.5, DOWN), g(b, 2, 0.5, DOWN)], [g(a, 2, 0.78, DOWN), g(b, 2, 0.78, DOWN)]], DARK, 0.006));
    }
    out.push(k.decal([[g(0.42, 2, 0.5, DOWN), g(0.8, 2, 0.5, DOWN)], [g(0.42, 2, 0.515, DOWN), g(0.8, 2, 0.515, DOWN)]], DARK, 0.006));
    out.push(k.decal([[g(0.42, 2, 0.765, DOWN), g(0.8, 2, 0.765, DOWN)], [g(0.42, 2, 0.78, DOWN), g(0.8, 2, 0.78, DOWN)]], DARK, 0.006));
    // Capot : deux prises NACA (triangles noirs qui s'ouvrent vers l'arrière), grande ouïe au milieu devant le pare-brise.
    out.push(k.decal([[g(0.3, 2, 0.35, DOWN), g(0.31, 2, 0.35, DOWN)], [g(0.22, 2, 0.7, DOWN), g(0.36, 2, 0.7, DOWN)]], GLOSS, 0.007));
    out.push(k.decal([[g(0, 2, 0.85, DOWN), g(0.12, 2, 0.85, DOWN), g(0.2, 2, 0.87, DOWN)], [g(0, 2, 1.12, DOWN), g(0.13, 2, 1.12, DOWN), g(0.22, 2, 1.1, DOWN)]], GLOSS, 0.007));
    for (const s of [0.9, 0.97, 1.04]) out.push(k.decal([[g(0, 2, s, DOWN), g(0.19, 2, s + 0.01, DOWN)], [g(0, 2, s + 0.025, DOWN), g(0.19, 2, s + 0.035, DOWN)]], MESH, 0.01));
    // Bouche noire basse au milieu, grillagée ; deux petites prises de frein aux coins ; lame en bas ; emblème neutre (losange) sur le nez.
    out.push(k.decal([[0, 0.2, 0.4].map((x) => g(x, 0.33, 0, FRONT)), [0, 0.2, 0.42].map((x) => g(x, 0.16, 0, FRONT))], GLOSS, 0.01));
    for (const y of [0.29, 0.245, 0.2]) out.push(k.decal([[0, 0.2, 0.39].map((x) => g(x, y + 0.006, 0, FRONT)), [0, 0.2, 0.39].map((x) => g(x, y - 0.006, 0, FRONT))], MESH, 0.014));
    out.push(k.decal([[g(0.52, 0.31, 0.1, frontTurn(12)), g(0.7, 0.31, 0.12, frontTurn(25))], [g(0.52, 0.19, 0.1, frontTurn(12)), g(0.7, 0.19, 0.12, frontTurn(25))]], GLOSS, 0.01));
    out.push(k.decal([[0, 0.4, 0.8, 0.9].map((x) => g(x, 0.12, 0, x > 0.6 ? frontTurn(45) : FRONT)), [0, 0.4, 0.8, 0.9].map((x) => g(x * 1.02, 0.085, 0, x > 0.6 ? frontTurn(50) : FRONT))], DARK, 0.02));
    out.push(k.decal([[g(-0.035, 0.4, 0.1, FRONT), g(0, 0.425, 0.1, FRONT), g(0.035, 0.4, 0.1, FRONT)], [g(-0.035, 0.4, 0.1, FRONT), g(0, 0.375, 0.1, FRONT), g(0.035, 0.4, 0.1, FRONT)]], CHROME, 0.016, false));

    // Fine ligne noire tout autour de la caisse : le nez, les flancs, la poupe.
    out.push(k.decal([[0, 0.3, 0.6, 0.8].map((x) => g(x, 0.365, 0, x > 0.5 ? frontTurn(40) : FRONT)), [0, 0.3, 0.6, 0.8].map((x) => g(x, 0.35, 0, x > 0.5 ? frontTurn(40) : FRONT))], GLOSS, 0.012));
    out.push(k.sideLine([[0.15, 0.37], [AXLE_F - 0.4, 0.4], [AXLE_F + 0.4, 0.43], [2.2, 0.44], [AXLE_R - 0.4, 0.45], [AXLE_R + 0.4, 0.46], [END - 0.04, 0.46]], 0.008, GLOSS, 0.009));
    // Flancs : ligne de porte ; prise d'air sur le haut de l'aile arrière, derrière la vitre ; prise basse devant la roue arrière ; ouïes derrière la roue.
    out.push(k.sideLine([[1.44, 0.2], [1.42, 0.5], [1.46, k.belt(1.46) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.5, 0.2], [2.52, k.belt(2.52) - 0.02]], 0.005, DARK));
    out.push(k.decal([
      [g(1, 0.74, 2.55, SIDE), g(1, 0.75, 2.75, SIDE), g(1, 0.77, 2.98, SIDE)],
      [g(1, 0.63, 2.62, SIDE), g(1, 0.65, 2.8, SIDE), g(1, 0.73, 2.98, SIDE)],
    ], GLOSS, 0.012, true, 1));
    out.push(k.decal([[g(1, 0.36, 2.7, SIDE), g(1, 0.36, 2.92, SIDE)], [g(1, 0.24, 2.76, SIDE), g(1, 0.24, 2.92, SIDE)]], GLOSS, 0.012));
    for (let i = 0; i < 4; i++) {
      const s = 3.9 + 0.07 * i;
      out.push(k.decal([[g(1, 0.75, s, SIDE), g(1, 0.75, s + 0.03, SIDE)], [g(1, 0.5, s, SIDE), g(1, 0.5, s + 0.03, SIDE)]], GLOSS, 0.012));
    }

    // Poupe : capot moteur en plexiglas, tout en persiennes de part et d'autre d'une arête ; montant noir derrière la vitre.
    out.push(k.decal([[g(0.04, 2, 3.0, DOWN), g(0.5, 2, 3.0, DOWN)], [g(0.04, 2, 4.1, DOWN), g(0.52, 2, 4.1, DOWN)]], PLEXI, 0.008, true, 2));
    for (let i = 0; i < 8; i++) {
      const s = 3.08 + 0.13 * i;
      out.push(k.decal([[g(0.07, 2, s, DOWN), g(0.47, 2, s, DOWN)], [g(0.07, 2, s + 0.06, DOWN), g(0.47, 2, s + 0.06, DOWN)]], GLOSS, 0.012, true, 2));
    }
    const e = k.cabinEdge(2.55);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.022, GLOSS, 4, false));

    // Arrière : bandeau noir où sont les quatre feux ronds (rouge dedans, clair cerclé d'orange dehors) et la plaque ; trois sorties au centre du
    // bouclier, dans une coque noire ovale ; deux catadioptres ; dessous noir.
    out.push(k.decal([
      [g(0, 0.76, END, REAR), g(0.5, 0.76, END, REAR), g(0.82, 0.76, END, rearTurn(10)), g(0.9, 0.75, END - 0.02, rearTurn(30))],
      [g(0, 0.47, END, REAR), g(0.5, 0.47, END, REAR), g(0.82, 0.47, END, rearTurn(10)), g(0.9, 0.48, END - 0.02, rearTurn(30))],
    ], GLOSS, 0.01, true, 1));
    for (const [x, inner] of [[0.58, true], [0.77, false]] as const) {
      out.push(ring(k, x, 0.625, END, REAR, 0.075, 0.09, HOUSING, 0.016));
      out.push(ring(k, x, 0.625, END, REAR, 0.004, 0.077, inner ? TAIL : AMBER, 0.02));
      if (!inner) out.push(ring(k, x, 0.625, END, REAR, 0.004, 0.035, LENS, 0.024));
    }
    out.push(k.plate(-0.27, 0.27, 0.55, 0.69, END, REAR, PLATE, 0.018, 2));
    out.push(k.decal([[-0.16, 0, 0.16].map((x) => g(x, 0.31, END, REAR)), [-0.16, 0, 0.16].map((x) => g(x, 0.22, END, REAR))], GLOSS, 0.014, false));
    const zt = k.z(END);
    for (const x of [-0.09, 0, 0.09]) {
      out.push(tube(new THREE.Vector3(x, 0.265, zt - 0.05), new THREE.Vector3(x, 0.265, zt + 0.03), 0.034, CHROME, 8, false));
      out.push(tube(new THREE.Vector3(x, 0.265, zt - 0.05), new THREE.Vector3(x, 0.265, zt + 0.025), 0.024, GLOSS, 8, true));
    }
    for (const m of [-1, 1]) out.push(k.plate(m * 0.7, m * 0.84, 0.29, 0.34, END, REAR, TAIL, 0.018));
    out.push(k.decal([[0, 0.4, 0.8, 0.9].map((x) => g(x, 0.2, END, x > 0.7 ? rearTurn(30) : REAR)), [0, 0.4, 0.8, 0.9].map((x) => g(x, 0.13, END - 0.04, x > 0.7 ? rearTurn(30) : REAR))], DARK, 0.012));
    // Le dessous de l'aileron, sombre, vu de derrière entre le capot et le plan.
    out.push(box(1.72, 0.012, 0.28, 0, 1.05, k.z(4.16), DARK));
    return out;
  },
};
