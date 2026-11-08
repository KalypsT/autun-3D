import * as THREE from "three";
import { FRONT, REAR, SIDE, frontTurn, podLoft, rearTurn, type Guide, type Sculpt, type SculptKit } from "./car-sculpt";
import { box, paint, tube } from "./vehicle-model";

/**
 * Petit SUV (Éduen Morvan, D275) sculpté d'après les photos fournies par l'utilisateur : un SUV compact français haut de gamme, version restylée
 * des années 2020 (face : trois-quarts avant et face), la silhouette et l'arrière d'après le profil et le trois-quarts arrière de la première version
 * (caisse inchangée au restylage) ; mesures 4,59 × 1,89 × 1,62 m (empattement de la fiche de conduite gardé, 2,62 m). Côté droit, en s.
 * Ce qui le fait reconnaître : face haute et droite, très grande calandre noire à pointes de diamant qui monte jusqu'aux phares, phares très minces
 * sous le bord du capot, et surtout, aux coins, les lames de feux de jour verticales et striées ; ceinture qui monte vers l'arrière, jonc chromé autour
 * des vitres qui finit en pointe sur le gros montant arrière, lunette presque droite sous un becquet ; à l'arrière, des feux horizontaux sombres
 * reliés par un jonc chromé ; passages de roue et bas de caisse noirs, grandes roues.
 */

const LIGHT = "#f5ecd2";
const LED = "#fff6dc";
const HOUSING = "#2a2d33";
const GLOSS = "#141519";
const DARK = "#1d1f24";
const MESH = "#6a6f79";
const TRIM = "#2c2c33";
const CHROME = "#c9ccd0";
const RAIL = "#3a3d44";
const TAIL = "#e0442c";
const TAIL_DARK = "#7e2219";
const AMBER = "#f1a03a";
const PLATE = "#f1e6c8";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Phare droit, très mince, sous le bord du capot : [x, haut, bas, s, angle du rayon], de la calandre au bout sur l'aile. */
const HEAD: readonly (readonly [number, number, number, number, number])[] = [
  [0.4, 0.895, 0.868, 0.03, 2],
  [0.53, 0.905, 0.866, 0.04, 8],
  [0.65, 0.915, 0.868, 0.06, 20],
  [0.75, 0.925, 0.876, 0.11, 42],
  [0.83, 0.935, 0.892, 0.2, 68],
  [0.87, 0.94, 0.92, 0.3, 88],
];

/** Feu arrière droit : horizontal, effilé vers le centre, qui tourne sur l'aile en pointe. */
const TAILLAMP: readonly (readonly [number, number, number, number, number])[] = [
  [0.4, 1.085, 1.06, 4.51, 0],
  [0.55, 1.095, 1.035, 4.505, 4],
  [0.68, 1.1, 1.02, 4.48, 18],
  [0.79, 1.105, 1.03, 4.42, 50],
  [0.86, 1.105, 1.065, 4.32, 82],
  [0.88, 1.1, 1.09, 4.22, 90],
];

/** Pointes de diamant de la calandre : des traits en diagonale dans les deux sens, coupés au rectangle (côté droit ; la moitié gauche en miroir). */
function diamondLines(x0: number, x1: number, y0: number, y1: number, step: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const slope of [1, -1]) {
    for (let c = x0 - (y1 - y0); c <= x1; c += step) {
      // Droite x = c + (y − y0)·slope (ou depuis le haut), coupée à [x0, x1] × [y0, y1].
      const pts: [number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const y = y0 + ((y1 - y0) * i) / 40, x = slope > 0 ? c + (y - y0) : c + (y1 - y);
        if (x >= x0 - 1e-6 && x <= x1 + 1e-6) pts.push([x, y]);
      }
      if (pts.length >= 4) out.push([pts[0]![0], pts[0]![1], pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
    }
  }
  return out;
}

/** Bord de la vitre de flanc droite, décalé vers l'extérieur pour poser un jonc. */
function edge(k: SculptKit, s: number, which: "base" | "top" | "roof"): THREE.Vector3 {
  return k.cabinEdge(s)[which];
}

export const PETIT_SUV: Sculpt = {
  top: [
    [0, 0.8], [0.04, 0.9], [0.1, 0.95], [0.2, 0.98], [0.4, 1.0], [0.9, 1.04], [1.45, 1.1], [2.0, 1.12], [2.5, 1.14], [3.0, 1.165],
    [3.5, 1.2], [4.05, 1.225], [4.2, 1.215], [4.33, 1.16], [4.45, 1.1], [4.51, 1.0], [4.546, 0.86],
  ],
  bottom: [[0, 0.34], [0.04, 0.29], [0.1, 0.27], [0.2, 0.26], [0.4, 0.25], [1.45, 0.24], [3.0, 0.24], [4.05, 0.26], [4.33, 0.29], [4.45, 0.31], [4.51, 0.33], [4.546, 0.38]],
  width: [
    [0, 0.6], [0.04, 0.74], [0.1, 0.83], [0.2, 0.885], [0.4, 0.915], [0.908, 0.925], [1.45, 0.915], [2.0, 0.905], [2.5, 0.905], [3.0, 0.91],
    [3.528, 0.925], [4.05, 0.912], [4.2, 0.89], [4.33, 0.86], [4.45, 0.82], [4.51, 0.78], [4.546, 0.68],
  ],
  cabin: [
    [1.36, 0, 0.8], [1.7, 1.37, 0.76], [2.02, 1.555, 0.7], [2.6, 1.575, 0.705], [3.3, 1.56, 0.695], [3.75, 1.53, 0.67], [3.97, 1.495, 0.63], [4.22, 0, 0.7],
  ],
  windows: { shield: [1.36, 2.02], rear: [3.97, 4.22], side: [1.36, 3.75] },
  arch: 0.43,
  lamps: { head: [0.66, 0.89, 0.06], tail: [0.66, 1.06, 4.49] },

  paint: (k) => [
    // Becquet au bout du toit, au-dessus de la lunette.
    box(1.2, 0.035, 0.2, 0, 1.49, k.z(3.97), "#ffffff"),
    // Le bout de la vitre arrière, en pointe : le jonc du haut redescend vers la ceinture sur le gros montant arrière.
    k.decal([
      [g(1, edge(k, 3.42, "top").y + 0.01, 3.42, SIDE), g(1, edge(k, 3.76, "top").y + 0.01, 3.76, SIDE)],
      [g(1, edge(k, 3.42, "top").y + 0.005, 3.42, SIDE), g(1, edge(k, 3.76, "base").y + 0.03, 3.76, SIDE)],
    ], "#ffffff", 0.004),
  ],

  details: (k) => {
    const out: THREE.BufferGeometry[] = [];
    // Phares très minces : boîtier sombre, glace, trois modules de diodes ; clignotant au bout.
    const head = (grow: number, inner = 0): Guide[][] => [
      HEAD.map(([x, t, , s, a], i) => g(x, t + grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) - inner, s, frontTurn(a))),
      HEAD.map(([x, , b, s, a], i) => g(x, b - grow * (i > 0 && i < HEAD.length - 1 ? 1 : 0.3) + inner, s, frontTurn(a))),
    ];
    out.push(k.decal(head(0.012), HOUSING, 0.012, true, 1));
    out.push(k.decal(head(0, 0.004), LIGHT, 0.018, true, 1));
    for (const [x, a] of [[0.5, 6], [0.6, 14], [0.7, 28]] as const) {
      out.push(k.decal([[g(x - 0.022, 0.9, 0.04, frontTurn(a)), g(x + 0.022, 0.903, 0.05, frontTurn(a))], [g(x - 0.022, 0.874, 0.04, frontTurn(a)), g(x + 0.022, 0.874, 0.05, frontTurn(a))]], LED, 0.023));
    }
    out.push(k.decal([[g(0.875, 0.935, 0.24, SIDE), g(0.875, 0.94, 0.3, SIDE)], [g(0.875, 0.922, 0.24, SIDE), g(0.875, 0.928, 0.3, SIDE)]], AMBER, 0.022));

    // Très grande calandre noire : du bord du capot (entre les phares) jusqu'en bas du bouclier, un peu plus large au milieu ;
    // pointes de diamant suggérées par des traits croisés plus clairs ; emblème neutre en losange au milieu.
    const gx = [0, 0.17, 0.34, 0.5];
    out.push(k.decal([
      gx.map((x) => g(x * 1.04, 0.86, 0, FRONT)),
      gx.map((x) => g(x * 1.08, 0.8, 0, FRONT)),
      gx.map((x) => g(x * 1.11, 0.73, 0, FRONT)),
      gx.map((x) => g(x * 1.12, 0.66, 0, FRONT)),
      gx.map((x) => g(x * 1.08, 0.56, 0, FRONT)),
      gx.map((x) => g(x * 1.02, 0.46, 0, FRONT)),
      gx.map((x) => g(x * 0.9, 0.4, 0.01, FRONT)),
    ], GLOSS, 0.01));
    for (const [xa, ya, xb, yb] of diamondLines(0.02, 0.5, 0.47, 0.84, 0.085)) {
      const d = 0.0045;
      out.push(k.decal([[g(xa - d, ya, 0, FRONT), g(xb - d, yb, 0, FRONT)], [g(xa + d, ya, 0, FRONT), g(xb + d, yb, 0, FRONT)]], MESH, 0.017));
    }
    out.push(k.decal([[g(-0.04, 0.73, 0, FRONT), g(0, 0.775, 0, FRONT), g(0.04, 0.73, 0, FRONT)], [g(-0.04, 0.73, 0, FRONT), g(0, 0.685, 0, FRONT), g(0.04, 0.73, 0, FRONT)]], CHROME, 0.017, false));
    out.push(k.decal([[g(-0.022, 0.73, 0, FRONT), g(0, 0.755, 0, FRONT), g(0.022, 0.73, 0, FRONT)], [g(-0.022, 0.73, 0, FRONT), g(0, 0.705, 0, FRONT), g(0.022, 0.73, 0, FRONT)]], DARK, 0.02, false));
    out.push(k.plate(-0.26, 0.26, 0.47, 0.575, 0, FRONT, PLATE, 0.02, 2));

    // Bas du bouclier : prise d'air noire sur toute la largeur, lame chromée dessous.
    const lx = [0, 0.22, 0.44, 0.6];
    out.push(k.decal([lx.map((x) => g(x, 0.4, 0.01, FRONT)), lx.map((x) => g(x * 1.02, 0.3, 0.02, FRONT))], DARK, 0.007));
    out.push(k.decal([lx.map((x) => g(x * 0.95, 0.295, 0.02, FRONT)), lx.map((x) => g(x * 0.95, 0.275, 0.03, FRONT))], CHROME, 0.011));

    // Aux coins : la signature, une niche sombre et quatre lames de feux de jour verticales, striées, qui descendent du phare.
    out.push(k.decal([
      [g(0.62, 0.84, 0.05, frontTurn(18)), g(0.72, 0.85, 0.08, frontTurn(32)), g(0.81, 0.85, 0.14, frontTurn(55))],
      [g(0.63, 0.64, 0.05, frontTurn(18)), g(0.74, 0.64, 0.09, frontTurn(36)), g(0.83, 0.64, 0.16, frontTurn(60))],
      [g(0.66, 0.45, 0.06, frontTurn(20)), g(0.75, 0.45, 0.1, frontTurn(38)), g(0.82, 0.47, 0.16, frontTurn(58))],
    ], HOUSING, 0.009));
    for (let i = 0; i < 4; i++) {
      const t = i / 3, x = 0.645 + 0.15 * t, a = 20 + 34 * t;
      out.push(k.decal([
        [g(x, 0.83, 0.06, frontTurn(a)), g(x + 0.016, 0.83, 0.06, frontTurn(a + 3))],
        [g(x + 0.012, 0.64, 0.07, frontTurn(a + 2)), g(x + 0.028, 0.64, 0.07, frontTurn(a + 5))],
        [g(x + 0.02 - 0.03 * t, 0.47, 0.07, frontTurn(a)), g(x + 0.034 - 0.03 * t, 0.47, 0.07, frontTurn(a + 3))],
      ], LED, 0.016));
    }

    // Montants noirs : central et entre la porte arrière et la vitre de custode.
    for (const s of [2.44, 3.18]) {
      const e = k.cabinEdge(s);
      for (const m of [-1, 1]) out.push(tube(new THREE.Vector3(m * e.base.x, e.base.y + 0.02, e.base.z), new THREE.Vector3(m * e.top.x, e.top.y, e.top.z), 0.03, GLOSS, 4, false));
    }
    // Jonc chromé autour des vitres : le pied le long de la ceinture, le haut sous le toit, qui se rejoignent en pointe sur le montant arrière ;
    // barres de toit sombres.
    for (const m of [-1, 1]) {
      const strip = (pts: THREE.Vector3[], r: number, color: string, dy: number, dx = 0.006): void => {
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]!, c = pts[i + 1]!;
          out.push(tube(new THREE.Vector3(m * (a.x + dx), a.y + dy, a.z), new THREE.Vector3(m * (c.x + dx), c.y + dy, c.z), r, color, 3, false));
        }
      };
      const tip = edge(k, 3.76, "base").clone().add(new THREE.Vector3(0, 0.035, 0));
      strip([...[1.5, 2.2, 2.9, 3.5].map((s) => edge(k, s, "base")), tip], 0.008, CHROME, 0.02);
      strip([...[1.55, 1.85, 2.1, 2.8, 3.42].map((s) => edge(k, s, "top")), tip], 0.008, CHROME, -0.008);
      strip([2.15, 2.9, 3.6, 3.9].map((s) => edge(k, s, "roof").clone().add(new THREE.Vector3(-0.04, 0, 0))), 0.016, RAIL, 0.035, 0);
    }

    // Flancs : lignes de portes, poignées, bas de caisse noir, passages de roue noirs, petit jonc chromé sur la porte avant.
    out.push(k.sideLine([[1.42, 0.36], [1.4, 0.7], [1.44, k.belt(1.44) - 0.02]], 0.005, DARK));
    out.push(k.sideLine([[2.44, 0.3], [2.44, k.belt(2.44) - 0.015]], 0.005, DARK));
    out.push(k.sideLine([[3.0, 0.3], [3.02, 0.72], [3.12, 0.92], [3.18, k.belt(3.18) - 0.015]], 0.005, DARK));
    for (const s of [2.16, 2.98]) out.push(k.sideLine([[s, k.belt(s) - 0.1], [s + 0.15, k.belt(s) - 0.1]], 0.013, TRIM, 0.01));
    out.push(k.sideLine([[1.6, 0.47], [1.86, 0.47]], 0.006, CHROME, 0.01));
    out.push(k.sideLine([[1.42, 0.33], [2.2, 0.32], [3.0, 0.33]], 0.06, DARK, 0.009));
    for (const a of [0.908, 3.528]) {
      const arc: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const t = Math.PI * (1 - i / 8), r = 0.43 + 0.065;
        arc.push([a + Math.cos(t) * r, k.frame.wheelRadius + Math.sin(t) * r]);
      }
      arc[0]![1] = Math.max(arc[0]![1], 0.4);
      arc[8]![1] = Math.max(arc[8]![1], 0.4);
      out.push(k.sideLine(arc, 0.05, DARK, 0.012));
    }

    // Rétroviseurs noirs.
    for (const m of [-1, 1]) {
      out.push(paint(podLoft([
        { x: m * 0.82, y: 1.13, z: k.z(1.5), w: 0.03, h: 0.035 },
        { x: m * 0.89, y: 1.15, z: k.z(1.55), w: 0.06, h: 0.06 },
        { x: m * 0.89, y: 1.15, z: k.z(1.69), w: 0.055, h: 0.055 },
      ], DARK, 6), DARK));
    }

    // Arrière : feux horizontaux sombres à écailles rouges, reliés par un jonc chromé d'un feu à l'autre.
    const tail = (grow: number): Guide[][] => [
      TAILLAMP.map(([x, t, , s, a], i) => g(x, t + (i > 0 && i < TAILLAMP.length - 1 ? grow : grow * 0.3), s, rearTurn(a))),
      TAILLAMP.map(([x, , b, s, a], i) => g(x, b - (i > 0 && i < TAILLAMP.length - 1 ? grow : grow * 0.3), s, rearTurn(a))),
    ];
    out.push(k.decal(tail(0.01), HOUSING, 0.014, true, 1));
    out.push(k.decal(tail(0), TAIL_DARK, 0.02, true, 1));
    for (const [x, s, a] of [[0.5, 4.51, 2], [0.6, 4.5, 8], [0.7, 4.47, 22], [0.79, 4.42, 50]] as const) {
      out.push(k.decal([[g(x - 0.03, 1.085, s, rearTurn(a)), g(x + 0.03, 1.09, s, rearTurn(a))], [g(x - 0.01, 1.045, s, rearTurn(a)), g(x + 0.02, 1.04, s, rearTurn(a))]], TAIL, 0.026));
    }
    out.push(k.decal([[0, 0.2, 0.41].map((x) => g(x, 1.07, 4.53, REAR)), [0, 0.2, 0.41].map((x) => g(x, 1.058, 4.53, REAR))], CHROME, 0.016));
    out.push(k.plate(-0.035, 0.035, 0.985, 1.035, 4.53, REAR, CHROME, 0.016));

    // Hayon : plaque ; bouclier : bas noir, jonc chromé, deux sorties trapézoïdales, catadioptres.
    out.push(k.plate(-0.26, 0.26, 0.79, 0.895, 4.55, REAR, PLATE, 0.012, 2));
    out.push(k.decal([[0, 0.25, 0.5, 0.68, 0.8].map((x) => g(x, 0.5, 4.52, rearTurn(x > 0.6 ? 35 : 0))), [0, 0.25, 0.5, 0.68, 0.82].map((x) => g(x, 0.34, 4.52, rearTurn(x > 0.6 ? 35 : 0)))], DARK, 0.008));
    out.push(k.decal([[0, 0.3, 0.6].map((x) => g(x, 0.51, 4.52, REAR)), [0, 0.3, 0.6].map((x) => g(x, 0.495, 4.52, REAR))], CHROME, 0.013));
    out.push(k.decal([[g(0.4, 0.45, 4.53, REAR), g(0.62, 0.45, 4.52, REAR)], [g(0.42, 0.37, 4.53, REAR), g(0.6, 0.37, 4.52, REAR)]], CHROME, 0.014));
    out.push(k.decal([[g(0.43, 0.44, 4.53, REAR), g(0.59, 0.44, 4.52, REAR)], [g(0.44, 0.382, 4.53, REAR), g(0.58, 0.382, 4.52, REAR)]], GLOSS, 0.018));
    out.push(k.decal([[g(0.72, 0.6, 4.48, rearTurn(30)), g(0.8, 0.6, 4.43, rearTurn(50))], [g(0.72, 0.57, 4.48, rearTurn(30)), g(0.8, 0.57, 4.43, rearTurn(50))]], TAIL_DARK, 0.012));
    return out;
  },
};
