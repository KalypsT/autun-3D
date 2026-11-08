import * as THREE from "three";
import { DOWN, FRONT, REAR, SIDE, podLoft, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Deux-chevaux (Éduen Bourdon, D280) sculptée d'après les photos fournies par l'utilisateur : la première version (années 1950-1960 : trois-quarts
 * avant, profil, deux trois-quarts arrière) ; mesures 3,78 × 1,48 × 1,60 m, empattement réel de 2,40 m (fiche neuve). Côté droit, en s.
 * La caisse sculptée n'est que la coque centrale (capot étroit, habitacle, malle) ; les quatre ailes, les phares sur leur barre et les pare-chocs
 * sont des pièces rapportées, comme sur la vraie.
 * Ce qui la fait reconnaître : capot étroit à nervures qui plonge vers une petite calandre en trapèze, phares ronds posés au-dessus des ailes, ailes
 * avant bombées et détachées, pare-brise presque droit, toit de toile, portes avant qui s'ouvrent vers l'avant (poignées au bord avant), dos rond en
 * escargot avec une petite lunette, malle nervurée, petits feux ronds ; ailes arrière qui cachent le haut des roues ; pare-chocs fins à butoirs.
 */

const LIGHT = "#f2ead2";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const BLACK = "#202227";
const CANVAS = "#2e3034";
const CREASE = "#6b6f73";
const CHROME = "#c9ccd0";
const ALU = "#b5b8ba";
const TAIL = "#c8352a";
const AMBER = "#f0962e";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Essieux en s (porte-à-faux avant de `CAR_BODIES.deuche`, empattement de la fiche). */
const AXLE_F = 0.658;
const AXLE_R = 3.058;

/** Bout de la coque en s ; les pare-chocs vont du nez (s = −0,022) à 3,758. */
const END = 3.62;

/** Aile : sections elliptiques [s, centre x, demi-largeur, bas, haut], côté droit ; m = −1 pour sa copie à gauche. */
function wing(k: SculptKit, rows: readonly (readonly [number, number, number, number, number])[], m: number): THREE.BufferGeometry {
  return podLoft(rows.map(([s, xc, w, y0, y1]) => ({ x: m * xc, y: (y0 + y1) / 2, z: k.z(s), w, h: (y1 - y0) / 2 })), "#ffffff", 6);
}

/** Ailes avant, au-dessus des roues, détachées du capot. */
const FRONT_WING: readonly (readonly [number, number, number, number, number])[] = [
  [0.14, 0.55, 0.07, 0.42, 0.53], [0.26, 0.58, 0.13, 0.42, 0.71], [0.44, 0.6, 0.14, 0.5, 0.83], [AXLE_F, 0.6, 0.14, 0.58, 0.87],
  [0.88, 0.62, 0.12, 0.52, 0.82], [1.06, 0.66, 0.08, 0.4, 0.68], [1.24, 0.69, 0.035, 0.28, 0.4],
];

/** Ailes arrière, qui cachent le haut des roues. */
const REAR_WING: readonly (readonly [number, number, number, number, number])[] = [
  [2.74, 0.69, 0.03, 0.36, 0.62], [2.84, 0.69, 0.055, 0.38, 0.82], [AXLE_R, 0.68, 0.065, 0.4, 0.89], [3.26, 0.66, 0.06, 0.42, 0.82],
  [3.42, 0.62, 0.03, 0.46, 0.64],
];

/** Disque posé sur la caisse (centre x, y ; rayon), regardant vers `dir` : 8 segments. */
function disc(k: SculptKit, x: number, y: number, s: number, dir: THREE.Vector3, r: number, color: string, lift: number): THREE.BufferGeometry {
  // Le disque est dans le plan perpendiculaire au rayon : de face, en x et y ; de côté, en s et y.
  const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  const at = (rr: number): Guide[] => Array.from({ length: 9 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 8;
    return g(x + side.x * Math.cos(a) * rr, y + Math.sin(a) * rr, s + side.z * Math.cos(a) * rr, dir);
  });
  return k.decal([at(r), at(0.004)], color, lift);
}

export const DEUCHE: Sculpt = {
  top: [
    [0.1, 0.7], [0.16, 0.76], [0.3, 0.8], [AXLE_F, 0.86], [1.0, 0.93], [1.25, 0.98], [1.6, 1.0], [2.7, 1.0], [3.1, 0.97], [3.35, 0.9], [3.5, 0.78], [END, 0.6],
  ],
  bottom: [[0.1, 0.36], [0.4, 0.33], [1.2, 0.27], [2.8, 0.27], [3.5, 0.33], [END, 0.38]],
  width: [
    [0.1, 0.36], [0.2, 0.4], [AXLE_F, 0.47], [1.1, 0.58], [1.3, 0.68], [1.5, 0.7], [2.75, 0.7], [3.1, 0.66], [3.4, 0.56], [END, 0.45],
  ],
  cabin: [
    [1.25, 0, 0.6], [1.33, 1.3, 0.56], [1.42, 1.53, 0.52], [1.62, 1.59, 0.52], [2.2, 1.6, 0.52], [2.6, 1.56, 0.51], [2.9, 1.45, 0.5], [3.15, 1.25, 0.48],
    [3.42, 0, 0.46],
  ],
  windows: { shield: [1.25, 1.42], rear: [2.9, 3.15], side: [1.3, 2.75] },
  arch: 0.33,
  frontArch: false,
  lamps: { head: [0.52, 0.88, 0.14], tail: [0.38, 0.5, 3.62] },

  paint: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares ronds dans leur coquille couleur caisse, au-dessus des ailes.
    for (const m of [-1, 1]) {
      out.push(podLoft([
        { x: m * 0.52, y: 0.88, z: k.z(0.15), w: 0.085, h: 0.085 },
        { x: m * 0.52, y: 0.88, z: k.z(0.3), w: 0.05, h: 0.05 },
      ], "#ffffff", 6));
    }
    // Montant central couleur caisse, entre les deux vitres de porte.
    const b = k.cabinEdge(2.06);
    for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * b.base.x, b.base.y, b.base.z), new THREE.Vector3(m * b.top.x, b.top.y, b.top.z), 0.03, "#ffffff", 4, false));
    return out;
  },

  // Ailes (et, en deux tons seulement, le bas des portes en virgule) : la seconde teinte de la version en deux tons.
  tone: (k, twoTone) => {
    const out = [-1, 1].flatMap((m) => [wing(k, FRONT_WING, m), wing(k, REAR_WING, m)]);
    if (twoTone) {
      const top = [[1.3, 0.5], [1.8, 0.52], [2.3, 0.6], [2.5, 0.68], [2.68, 0.84]] as const;
      const row = (t: number): Guide[] => top.map(([s, y]) => g(1, 0.3 + (y - 0.3) * t, s, SIDE));
      out.push(k.decal([row(1), row(0.66), row(0.33), row(0)], "#ffffff", 0.012, true, 1));
    }
    return out;
  },

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];

    // Petite calandre en trapèze : cadre chromé, grille sombre à lames ; emblème neutre (petit losange chromé) en haut.
    const grille = (grow: number): Guide[][] => [
      [0, 0.09, 0.17 + grow].map((x) => g(x, 0.665 + grow, 0, FRONT)),
      [0, 0.12, 0.24 + grow].map((x) => g(x, 0.43 - grow, 0, FRONT)),
    ];
    out.push(k.decal(grille(0.018), CHROME, 0.008));
    out.push(k.decal(grille(0), GLOSS, 0.012));
    for (const y of [0.62, 0.575, 0.53, 0.485]) {
      const w = 0.17 + ((0.665 - y) / 0.235) * 0.07 - 0.015;
      out.push(k.decal([[g(0, y + 0.007, 0, FRONT), g(w, y + 0.007, 0, FRONT)], [g(0, y - 0.007, 0, FRONT), g(w, y - 0.007, 0, FRONT)]], HOUSING, 0.016));
    }
    out.push(k.decal([[g(-0.045, 0.64, 0, FRONT), g(0, 0.655, 0, FRONT), g(0.045, 0.64, 0, FRONT)], [g(-0.045, 0.64, 0, FRONT), g(0, 0.625, 0, FRONT), g(0.045, 0.64, 0, FRONT)]], CHROME, 0.02, false));

    // Capot à nervures ; ouïes sur ses flancs, devant le pare-brise.
    for (const x of [0, 0.1, 0.2, 0.3]) {
      const half = 0.006;
      out.push(k.decal([[0.22, 0.6, 1.0, 1.22].map((s) => g(x + half, 1, s, DOWN)), [0.22, 0.6, 1.0, 1.22].map((s) => g(x - half, 1, s, DOWN))], CREASE, 0.006, x > 0));
    }
    for (let i = 0; i < 5; i++) {
      const s = 0.98 + i * 0.045;
      out.push(k.sideLine([[s, 0.84], [s + 0.05, 0.92]], 0.008, DARK, 0.008));
    }

    // Phares : glace claire cerclée de chrome, au bout de la coquille ; barre sombre qui les porte au-dessus des ailes.
    for (const m of [-1, 1]) {
      out.push(paint(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 10).rotateX(Math.PI / 2).translate(m * 0.52, 0.88, k.z(0.14)), CHROME));
      out.push(paint(new THREE.CylinderGeometry(0.072, 0.072, 0.02, 10).rotateX(Math.PI / 2).translate(m * 0.52, 0.88, k.z(0.132)), LIGHT));
      out.push(tube(new THREE.Vector3(m * 0.52, 0.8, k.z(0.24)), new THREE.Vector3(m * 0.34, 0.76, k.z(0.24)), 0.018, DARK, 4, false));
      out.push(tube(new THREE.Vector3(m * 0.52, 0.8, k.z(0.24)), new THREE.Vector3(m * 0.52, 0.86, k.z(0.24)), 0.02, DARK, 4, false));
    }

    // Pare-chocs avant fin en aluminium, deux butoirs ; plaque au-dessus ; pattes sombres jusqu'à la coque.
    out.push(box(1.36, 0.05, 0.05, 0, 0.395, k.z(0.003), ALU));
    for (const m of [-1, 1]) {
      out.push(tube(new THREE.Vector3(m * 0.3, 0.33, k.z(0)), new THREE.Vector3(m * 0.3, 0.58, k.z(0.01)), 0.02, ALU, 6));
      out.push(box(0.05, 0.04, 0.1, m * 0.3, 0.37, k.z(0.08), DARK));
    }
    out.push(box(0.44, 0.1, 0.012, 0, 0.47, k.z(0.03), PLATE));

    // Flancs : clignotant orange devant la porte, lignes des portes, poignées aux bords avant et arrière (portes « suicide »), jonc chromé du
    // bas de caisse, garde-boue noirs derrière les roues avant.
    out.push(disc(k, 0, 0.82, 1.2, SIDE, 0.025, AMBER, 0.012));
    out.push(k.sideLine([[1.32, 0.3], [1.3, 0.7], [1.3, k.belt(1.3) - 0.01]], 0.005, DARK));
    out.push(k.sideLine([[2.06, 0.3], [2.06, k.belt(2.06) - 0.01]], 0.005, DARK));
    out.push(k.sideLine([[2.7, 0.33], [2.72, 0.7], [2.72, k.belt(2.72) - 0.01]], 0.005, DARK));
    for (const s of [1.36, 2.58]) out.push(k.sideLine([[s, 0.925], [s + 0.07, 0.925]], 0.012, CHROME, 0.012));
    out.push(k.sideLine([[1.34, 0.3], [2.0, 0.295], [2.66, 0.3]], 0.008, CHROME, 0.011));
    for (const m of [-1, 1]) out.push(box(0.012, 0.22, 0.14, m * 0.67, 0.3, k.z(1.02), BLACK));

    // Toit de toile, de l'arrière du pare-brise à la lunette.
    const roof = (s: number): Guide[] => [-0.46, -0.23, 0, 0.23, 0.46].map((x) => g(x, 2, s, DOWN));
    out.push(k.decal([roof(1.5), roof(2.0), roof(2.45), roof(2.85)], CANVAS, 0.014, false, 1));

    // Arrière : malle nervurée et son contour, poignée, plaque, petits feux ronds, pare-chocs fin.
    for (const x of [-0.06, 0, 0.06]) out.push(k.decal([[g(x - 0.006, 0.82, END, REAR), g(x + 0.006, 0.82, END, REAR)], [g(x - 0.006, 0.6, END, REAR), g(x + 0.006, 0.6, END, REAR)]], CREASE, 0.008, false));
    for (const m of [-1, 1]) out.push(k.decal([[g(m * 0.4 - 0.006, 0.84, END, REAR), g(m * 0.4 + 0.006, 0.84, END, REAR)], [g(m * 0.42 - 0.006, 0.44, END, REAR), g(m * 0.42 + 0.006, 0.44, END, REAR)]], DARK, 0.008, false));
    out.push(k.plate(-0.42, 0.42, 0.435, 0.447, END, REAR, DARK, 0.008, 4));
    out.push(k.plate(-0.03, 0.03, 0.575, 0.59, END, REAR, CHROME, 0.012));
    out.push(k.plate(-0.2, 0.2, 0.46, 0.55, END, REAR, PLATE, 0.012, 2));
    out.push(disc(k, 0.36, 0.5, END, REAR, 0.045, TAIL, 0.014));
    out.push(disc(k, 0.36, 0.5, END, REAR, 0.052, CHROME, 0.01));
    out.push(box(1.32, 0.05, 0.05, 0, 0.385, k.z(3.733), ALU));
    for (const m of [-1, 1]) out.push(box(0.05, 0.04, 0.1, m * 0.3, 0.37, k.z(3.66), DARK));
    return out;
  },
};
