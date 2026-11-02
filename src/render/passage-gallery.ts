import * as THREE from "three";
import type { PassageSite } from "../data/types";
import { at, frameOf, PASSAGE_SLAB } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { slab } from "./square";

/**
 * Passage Balthus, lot 2 (D188) : le décor de la galerie d'après les photos 2, 4 et 5. De chaque côté, sur 13 travées : vitrines à cadres blancs
 * entre des pilastres crème à consoles bleues et or, globes sur les pilastres, frise blanche à rosaces, étage de colonnes blanches à chapiteaux
 * dorés devant des fenêtres sombres, corniche dorée ; au-dessus, la charpente de la verrière (fermes, faîtière, pannes). Le verre n'est pas dessiné :
 * le jeu n'a pas de matière transparente qui ne porte pas d'ombre, et des plaques opaques feraient un tunnel sombre ; les fermes se lisent comme des
 * meneaux. Dans le maillage plein de la tuile (les globes aussi dans celui des vitres allumées, la nuit) : aucun appel de dessin de plus.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const CREAM = C("#efe6d0"), WHITE = C("#f4efe4"), BLUE = C("#1f3f8f"), GOLD = C("#c9a227"), DARK_GLASS = C("#35505c"), WINDOW = C("#4a6470"), IRON = C("#2f3a40");
const ROSETTE = C("#d8cdb0"), GLOBE = C("#fff4c8");
/** Travées par côté, pilastres et colonnes. */
export const BAYS = 13;
/** Hauteurs au-dessus du sol de la galerie : haut des pilastres, frise, appui et haut des fenêtres de l'étage, corniche, faîtage de la verrière. */
export const H = { pil: 4.3, frieze: [4.5, 5.7] as [number, number], win: [6.0, 8.3] as [number, number], col: [5.9, 8.45] as [number, number], cornice: [8.75, 9.05] as [number, number], ridge: 10.45 };

/** Étendue de la galerie : entre les deux linteaux. */
export function galleryRange(s: PassageSite): [number, number] {
  const mid = s.L / 2;
  return [Math.max(...s.lin.filter((l) => l[1] < mid).map((l) => l[1])), Math.min(...s.lin.filter((l) => l[0] > mid).map((l) => l[0]))];
}

export function buildGallery(mb: MeshBuilder, glow: MeshBuilder, s: PassageSite): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (d: number, t: number, z: number): Vec3 => toThree(...at(f, d, t), z);
  const NT = (u: number): Vec3 => toThree(f.vx * u, f.vy * u, 0);
  const hw = s.hw, zg = s.zf + PASSAGE_SLAB;
  const [g0, g1] = galleryRange(s);
  const b = (g1 - g0) / BAYS;
  const box = (sink: MeshBuilder, d0: number, d1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color): void => slab(sink, f, d0, d1, Math.min(t0, t1), Math.max(t0, t1), z0, z1, col, col);

  for (const sg of [-1, 1]) {
    /** Bande de profondeur o à o + w depuis le mur, côté sg. */
    const tt = (o: number, w: number): [number, number] => [sg * (hw - o), sg * (hw - o - w)];
    const face = (d0: number, d1: number, z0: number, z1: number, o: number, col: THREE.Color): void =>
      mb.quad(P(d0, sg * (hw - o), z0), P(d1, sg * (hw - o), z0), P(d1, sg * (hw - o), z1), P(d0, sg * (hw - o), z1), NT(-sg), col);

    for (let i = 0; i <= BAYS; i++) {
      const d = g0 + i * b, pw = 0.16;
      // Pilastre, console bleue à chapiteau doré, globe.
      box(mb, d - pw, d + pw, ...tt(0, 0.2), zg, zg + H.pil, CREAM);
      box(mb, d - pw - 0.05, d + pw + 0.05, ...tt(0, 0.3), zg + H.pil - 0.45, zg + H.pil, BLUE);
      box(mb, d - pw - 0.08, d + pw + 0.08, ...tt(0, 0.33), zg + H.pil, zg + H.pil + 0.1, GOLD);
      const gz0 = zg + 3.0, gz1 = zg + 3.35, gt = tt(0.2, 0.3);
      box(mb, d - 0.15, d + 0.15, ...gt, gz0, gz1, GLOBE);
      box(glow, d - 0.16, d + 0.16, gt[0] + sg * 0.01, gt[1] - sg * 0.01, gz0 - 0.01, gz1 + 0.01, GLOBE);
      // Colonne de l'étage et chapiteau doré.
      const ct = tt(0.42, 0.26);
      box(mb, d - 0.13, d + 0.13, ...ct, zg + H.col[0], zg + H.col[1], WHITE);
      box(mb, d - 0.2, d + 0.2, ct[0] + sg * -0.07, ct[1] + sg * 0.07, zg + H.col[1], zg + H.col[1] + 0.25, GOLD);
      if (i === BAYS) break;
      const d0 = d + pw, d1 = d + b - pw, dm = d + b / 2;
      // Vitrine : verre sombre, soubassement, imposte, meneau central.
      face(d0, d1, zg + 0.45, zg + 3.65, 0.06, DARK_GLASS);
      box(mb, d0, d1, ...tt(0, 0.12), zg, zg + 0.45, CREAM);
      box(mb, d0, d1, ...tt(0, 0.12), zg + 3.65, zg + 3.85, WHITE);
      box(mb, dm - 0.04, dm + 0.04, ...tt(0, 0.1), zg + 0.45, zg + 3.65, WHITE);
      box(mb, d0, d0 + 0.05, ...tt(0, 0.1), zg + 0.45, zg + 3.65, WHITE);
      box(mb, d1 - 0.05, d1, ...tt(0, 0.1), zg + 0.45, zg + 3.65, WHITE);
      // Frise blanche à deux rosaces.
      face(d0, d1, zg + H.frieze[0], zg + H.frieze[1], 0.05, WHITE);
      for (const k of [0.3, 0.7]) box(mb, d + b * k - 0.25, d + b * k + 0.25, ...tt(0.05, 0.05), zg + 4.75, zg + 5.45, ROSETTE);
      // Fenêtre de l'étage.
      face(d0 + 0.15, d1 - 0.15, zg + H.win[0], zg + H.win[1], 0.06, WINDOW);
      box(mb, d0 + 0.1, d1 - 0.1, ...tt(0, 0.1), zg + H.win[0] - 0.12, zg + H.win[0], CREAM);
    }
    // Cordon doré le long de toute la galerie, et couronnement.
    box(mb, g0, g1, ...tt(0, 0.32), zg + H.cornice[0], zg + H.cornice[1], GOLD);
  }

  // Charpente de la verrière : une ferme à chaque pilastre et au milieu de chaque travée.
  const zc = zg + H.cornice[1];
  const bar = (a: Vec3, c: Vec3, w: number): void => {
    const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const n1 = new THREE.Vector3().crossVectors(dir, up).normalize(), n2 = new THREE.Vector3().crossVectors(dir, n1).normalize();
    const at3 = (p: Vec3, s1: number, s2: number): Vec3 => [p[0] + (n1.x * s1 + n2.x * s2) * w / 2, p[1] + (n1.y * s1 + n2.y * s2) * w / 2, p[2] + (n1.z * s1 + n2.z * s2) * w / 2];
    const sides: [number, number, number, number][] = [[1, 1, -1, 1], [-1, 1, -1, -1], [-1, -1, 1, -1], [1, -1, 1, 1]];
    for (const [a1, a2, b1, b2] of sides) {
      const nrm: Vec3 = [(n1.x * (a1 + b1) + n2.x * (a2 + b2)) / 2, (n1.y * (a1 + b1) + n2.y * (a2 + b2)) / 2, (n1.z * (a1 + b1) + n2.z * (a2 + b2)) / 2];
      mb.quad(at3(a, a1, a2), at3(c, a1, a2), at3(c, b1, b2), at3(a, b1, b2), nrm, IRON);
    }
  };
  const ridge = zg + H.ridge;
  for (let k = 0; k <= 2 * BAYS; k++) {
    const d = g0 + (k * b) / 2;
    bar(P(d, -hw, zc), P(d, 0, ridge), 0.1);
    bar(P(d, hw, zc), P(d, 0, ridge), 0.1);
    if (k % 2 === 0) bar(P(d, -hw, zc - 0.05), P(d, hw, zc - 0.05), 0.08);
  }
  bar(P(g0, 0, ridge), P(g1, 0, ridge), 0.14);
  for (const t of [-hw / 2, hw / 2]) bar(P(g0, t, zc + (ridge - zc) / 2), P(g1, t, zc + (ridge - zc) / 2), 0.08);
}
