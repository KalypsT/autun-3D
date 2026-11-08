import * as THREE from "three";
import { DOWN, FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Supercar (Augusta Bibracte, D276) sculptée d'après les photos fournies par l'utilisateur : une supercar italienne à moteur V12 central des années
 * 2010, dans sa version la plus radicale (trois-quarts avant et arrière, arrière de face, profil), la face d'après la première version (mêmes phares,
 * même capot) ; mesures 4,94 × 2,03 × 1,14 m, empattement réel (2,70 m). Côté droit, en s.
 * Ce qui la fait reconnaître : un coin très bas et très large, capot plongeant, phares anguleux posés sur les ailes, grandes prises d'air noires
 * aux coins ; pare-brise immense qui file jusqu'au toit, petite cabine étroite, vitre de flanc dont le bas monte vers l'arrière, énorme prise d'air
 * noire derrière la porte ; capot moteur à persiennes en V, grand aileron noir sur un mât ; à l'arrière, feux minces en Y au-dessus d'une grande
 * grille noire barrée d'une arche couleur caisse, deux grosses sorties rondes en haut, diffuseur à ailettes.
 */

const LIGHT = "#f5ecd2";
const LED = "#fff6dc";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const CARBON = "#25272c";
const MESH = "#3a3e46";
const TRIM = "#3c4048";
const CHROME = "#c9ccd0";
const TAIL = "#e0442c";
const TAIL_DARK = "#6e1d16";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.supercar`, empattement de la fiche). */
const AXLE_F = 1.078;
const AXLE_R = 3.778;

export const SUPERCAR: Sculpt = {
  top: [
    [0, 0.42], [0.05, 0.47], [0.12, 0.5], [0.35, 0.56], [0.7, 0.68], [1.175, 0.8], [1.6, 0.8], [2.2, 0.83], [2.7, 0.89], [3.2, 0.96],
    [3.778, 0.99], [4.2, 0.975], [4.6, 0.95], [4.8, 0.92], [4.896, 0.85],
  ],
  bottom: [[0, 0.11], [0.12, 0.11], [0.6, 0.12], [1.6, 0.12], [3.2, 0.12], [4.5, 0.16], [4.8, 0.2], [4.896, 0.26]],
  width: [
    [0, 0.62], [0.05, 0.8], [0.12, 0.88], [0.35, 0.94], [0.7, 0.97], [1.078, 0.98], [1.6, 0.96], [2.2, 0.955], [2.8, 0.985], [3.3, 1.0],
    [3.778, 1.012], [4.3, 1.0], [4.6, 0.98], [4.8, 0.94], [4.896, 0.88],
  ],
  cabin: [[1.175, 0, 0.8], [1.5, 0.94, 0.74], [1.84, 1.12, 0.62], [2.13, 1.14, 0.6], [2.59, 1.115, 0.58], [2.9, 1.07, 0.58], [3.2, 0, 0.7]],
  windows: { shield: [1.175, 1.84], rear: [2.59, 3.2], side: [1.175, 2.75] },
  arch: 0.38,
  lamps: { head: [0.72, 0.62, 0.5], tail: [0.7, 0.88, 4.88] },

  paint: (k) => [
    // Mât de l'aileron, au milieu du capot moteur.
    box(0.05, 0.15, 0.3, 0, 1.03, k.z(4.55), "#ffffff"),
    // Arche couleur caisse qui barre la grille arrière : un bandeau au-dessus des sorties, qui remonte aux coins.
    k.decal([
      [g(0, 0.47, 4.9, REAR), g(0.4, 0.47, 4.9, REAR), g(0.68, 0.52, 4.88, rearTurn(10)), g(0.88, 0.72, 4.84, rearTurn(30))],
      [g(0, 0.42, 4.9, REAR), g(0.4, 0.42, 4.9, REAR), g(0.72, 0.47, 4.88, rearTurn(10)), g(0.93, 0.68, 4.84, rearTurn(35))],
    ], "#ffffff", 0.016),
  ],

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares anguleux posés sur les ailes : boîtier sombre, glace, feu de jour en Y.
    const headRows = (grow: number): Guide[][] => [
      [g(0.52 - grow, 0.665 + grow, 0.5, FRONT), g(0.7, 0.665 + grow, 0.5, frontTurn(12)), g(0.88 + grow, 0.645 + grow, 0.55, frontTurn(40))],
      [g(0.6 - grow, 0.6 - grow, 0.45, FRONT), g(0.74, 0.6 - grow, 0.45, frontTurn(14)), g(0.9 + grow, 0.61 - grow, 0.5, frontTurn(45))],
    ];
    out.push(k.decal(headRows(0.022), GLOSS, 0.012, true, 2));
    out.push(k.decal(headRows(0.004), HOUSING, 0.017, true, 2));
    out.push(k.decal(headRows(-0.012), LIGHT, 0.02, true, 1));
    out.push(k.decal([[g(0.6, 0.655, 0.5, FRONT), g(0.66, 0.62, 0.5, frontTurn(6))], [g(0.62, 0.66, 0.5, FRONT), g(0.68, 0.625, 0.5, frontTurn(8))]], LED, 0.023));
    out.push(k.decal([[g(0.66, 0.62, 0.5, frontTurn(6)), g(0.86, 0.635, 0.5, frontTurn(38))], [g(0.66, 0.61, 0.5, frontTurn(6)), g(0.86, 0.623, 0.5, frontTurn(38))]], LED, 0.025));

    // Grandes prises d'air noires aux coins, avec une lame ; prise centrale basse ; lame avant ; deux fentes sur le capot ; emblème neutre (hexagone).
    out.push(k.decal([
      [g(0.44, 0.41, 0.1, FRONT), g(0.62, 0.43, 0.1, frontTurn(12)), g(0.8, 0.43, 0.12, frontTurn(35)), g(0.94, 0.41, 0.2, frontTurn(62))],
      [g(0.43, 0.28, 0.05, FRONT), g(0.62, 0.29, 0.06, frontTurn(12)), g(0.8, 0.29, 0.08, frontTurn(35)), g(0.96, 0.29, 0.2, frontTurn(66))],
      [g(0.42, 0.16, 0.05, FRONT), g(0.62, 0.15, 0.05, frontTurn(12)), g(0.8, 0.15, 0.08, frontTurn(35)), g(0.96, 0.18, 0.2, frontTurn(70))],
    ], GLOSS, 0.013, true, 2));
    out.push(k.decal([[g(0.5, 0.31, 0.1, FRONT), g(0.75, 0.32, 0.1, frontTurn(28)), g(0.92, 0.31, 0.2, frontTurn(64))], [g(0.5, 0.29, 0.1, FRONT), g(0.75, 0.3, 0.1, frontTurn(28)), g(0.92, 0.29, 0.2, frontTurn(64))]], TRIM, 0.014));
    out.push(k.decal([[0, 0.18, 0.36].map((x) => g(x, 0.3, 0, FRONT)), [0, 0.18, 0.36].map((x) => g(x * 1.05, 0.15, 0, FRONT))], DARK, 0.009));
    for (const y of [0.26, 0.21]) out.push(k.decal([[0, 0.17, 0.34].map((x) => g(x, y + 0.006, 0, FRONT)), [0, 0.17, 0.34].map((x) => g(x, y - 0.006, 0, FRONT))], MESH, 0.013));
    out.push(k.decal([[0, 0.4, 0.8, 0.96].map((x) => g(x, 0.145, 0, x > 0.7 ? frontTurn(50) : FRONT)), [0, 0.4, 0.8, 0.98].map((x) => g(x, 0.105, 0, x > 0.7 ? frontTurn(55) : FRONT))], CARBON, 0.02));
    out.push(k.decal([[g(0.16, 0.56, 0.4, FRONT), g(0.32, 0.555, 0.4, FRONT)], [g(0.16, 0.535, 0.4, FRONT), g(0.32, 0.53, 0.4, FRONT)]], GLOSS, 0.01));
    out.push(k.decal([[g(-0.03, 0.47, 0.1, FRONT), g(0, 0.485, 0.1, FRONT), g(0.03, 0.47, 0.1, FRONT)], [g(-0.03, 0.44, 0.1, FRONT), g(0, 0.425, 0.1, FRONT), g(0.03, 0.44, 0.1, FRONT)]], CHROME, 0.016, false));

    // Flancs : énorme prise d'air noire derrière la porte, en coin ; ligne de porte ; bas de caisse en carbone ; rétroviseurs sur pied.
    out.push(k.decal([
      [g(1, 0.8, 2.5, SIDE), g(1, 0.82, 2.75, SIDE), g(1, 0.84, 3.0, SIDE), g(1, 0.86, 3.24, SIDE)],
      [g(1, 0.56, 2.53, SIDE), g(1, 0.6, 2.76, SIDE), g(1, 0.67, 2.98, SIDE), g(1, 0.76, 3.2, SIDE)],
      [g(1, 0.32, 2.56, SIDE), g(1, 0.38, 2.76, SIDE), g(1, 0.5, 2.96, SIDE), g(1, 0.66, 3.16, SIDE)],
    ], GLOSS, 0.012, true, 1));
    out.push(k.sideLine([[1.32, 0.3], [1.3, 0.6], [1.36, k.belt(1.36) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.52, 0.3], [2.54, k.belt(2.54) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[AXLE_F + 0.46, 0.18], [2.2, 0.17], [AXLE_R - 0.46, 0.18]], 0.05, CARBON, 0.01));
    for (const m of [-1, 1]) {
      out.push(paint(podLoft([
        { x: m * 0.84, y: 0.86, z: k.z(1.62), w: 0.02, h: 0.02 },
        { x: m * 0.93, y: 0.9, z: k.z(1.66), w: 0.02, h: 0.02 },
        { x: m * 0.95, y: 0.9, z: k.z(1.6), w: 0.045, h: 0.04 },
        { x: m * 0.95, y: 0.9, z: k.z(1.74), w: 0.04, h: 0.035 },
      ], DARK, 5), DARK));
    }
    // Montant derrière la vitre, noir.
    const e = k.cabinEdge(2.75);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.025, GLOSS, 4, false));

    // Capot moteur : persiennes en V (fentes noires), de part et d'autre d'une arête couleur caisse.
    for (let i = 0; i < 4; i++) {
      const s = 3.32 + 0.24 * i;
      out.push(k.decal([[g(0.07, 2, s, DOWN), g(0.55, 2, s + 0.16, DOWN)], [g(0.07, 2, s + 0.08, DOWN), g(0.55, 2, s + 0.24, DOWN)]], GLOSS, 0.008));
    }
    // Grand aileron noir, avec ses deux dérives.
    out.push(box(1.86, 0.03, 0.32, 0, 1.1, k.z(4.62), CARBON));
    for (const m of [-1, 1]) out.push(box(0.02, 0.2, 0.4, m * 0.93, 1.02, k.z(4.62), CARBON));

    // Arrière : grande grille noire, feux minces en Y au-dessus, deux grosses sorties rondes, diffuseur à ailettes, plaque.
    out.push(k.decal([
      [g(0, 0.84, 4.9, REAR), g(0.45, 0.85, 4.9, REAR), g(0.75, 0.84, 4.86, rearTurn(15)), g(0.92, 0.8, 4.8, rearTurn(45))],
      [g(0, 0.4, 4.9, REAR), g(0.45, 0.4, 4.9, REAR), g(0.75, 0.42, 4.86, rearTurn(15)), g(0.95, 0.44, 4.8, rearTurn(45))],
    ], GLOSS, 0.01, true, 1));
    for (const y of [0.78, 0.7, 0.62, 0.54]) out.push(k.decal([[0, 0.3, 0.6].map((x) => g(x, y + 0.005, 4.9, REAR)), [0, 0.3, 0.6].map((x) => g(x, y - 0.005, 4.9, REAR))], MESH, 0.014));
    const lamp = (grow: number): Guide[][] => [
      [g(0.34, 0.915 + grow, 4.86, REAR), g(0.6, 0.925 + grow, 4.84, rearTurn(8)), g(0.82, 0.915 + grow, 4.78, rearTurn(35)), g(0.94, 0.89 + grow, 4.68, rearTurn(70))],
      [g(0.36, 0.875 - grow, 4.86, REAR), g(0.6, 0.865 - grow, 4.84, rearTurn(8)), g(0.82, 0.86 - grow, 4.78, rearTurn(35)), g(0.95, 0.87 - grow, 4.68, rearTurn(70))],
    ];
    out.push(k.decal(lamp(0.01), HOUSING, 0.016, true, 1));
    out.push(k.decal(lamp(0), TAIL_DARK, 0.022, true, 1));
    for (const [x, a] of [[0.48, 4], [0.64, 10], [0.8, 32]] as const) {
      out.push(k.decal([[g(x - 0.04, 0.912, 4.84, rearTurn(a)), g(x + 0.04, 0.912, 4.84, rearTurn(a))], [g(x - 0.004, 0.875, 4.84, rearTurn(a)), g(x + 0.004, 0.875, 4.84, rearTurn(a))]], TAIL, 0.028));
    }
    const zt = k.z(4.9);
    for (const m of [-1, 1]) {
      out.push(tube(new THREE.Vector3(m * 0.22, 0.6, zt - 0.06), new THREE.Vector3(m * 0.22, 0.6, zt + 0.03), 0.068, CHROME, 8, false));
      out.push(tube(new THREE.Vector3(m * 0.22, 0.6, zt - 0.06), new THREE.Vector3(m * 0.22, 0.6, zt + 0.025), 0.05, GLOSS, 8, true));
    }
    out.push(k.decal([[0, 0.3, 0.6, 0.86].map((x) => g(x, 0.4, 4.9, x > 0.7 ? rearTurn(35) : REAR)), [0, 0.3, 0.6, 0.86].map((x) => g(x, 0.16, 4.86, x > 0.7 ? rearTurn(35) : REAR))], CARBON, 0.012));
    for (const x of [0.12, 0.42, 0.62]) out.push(k.decal([[g(x, 0.36, 4.9, REAR), g(x + 0.012, 0.36, 4.9, REAR)], [g(x, 0.13, 4.88, REAR), g(x + 0.012, 0.13, 4.88, REAR)]], TRIM, 0.02));
    out.push(k.plate(-0.26, 0.26, 0.24, 0.34, 4.9, REAR, PLATE, 0.022, 2));
    return out;
  },
};
