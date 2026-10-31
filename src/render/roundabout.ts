import * as THREE from "three";
import type { HeightField, RoundaboutSite } from "../data/types";
import { TRUNK_R } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { fillOnTerrain } from "./ground";
import { T } from "./style";

/**
 * Îlot de rond-point d'après photo (D142) : pelouse bombée (le relief LiDAR a déjà le bombé) bordée d'une bordure basse claire, massif de
 * fleurs au pied de l'arbre, quelques arbustes bas, et l'arbre du centre : un cèdre à plateaux horizontaux étagés, bleu-vert, dont chaque
 * plateau a le rayon de la couronne mesuré à sa hauteur. Pas d'éclairage la nuit (choix de l'utilisateur).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const CURB = C("#e2ddd2"), SOIL = C("#6e5640"), BARK = C("#5a4636"), NEEDLES = C("#3f6a63"), NEEDLES_TOP = C("#5c8a80"), SHRUB = C("#4d7a45");
/** Pelouse de l'îlot au-dessus des trottoirs (0,15 m) que build_public_space.py avait posés dans l'îlot : la bordure les cache. */
const LAWN_LIFT = 0.22, CURB_TOP = 0.26;
const SEG = 48;

function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ring = (cx: number, cy: number, r: number, n = SEG): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n));
  return out;
};

/** Sols de l'îlot (maillage des sols de la tuile) : pelouse jusqu'à la bordure, terre du massif. */
export function buildRoundaboutGround(mb: MeshBuilder, s: RoundaboutSite, terrain: HeightField): void {
  const [cx, cy] = s.c;
  fillOnTerrain(mb, [ring(cx, cy, s.r - s.curb / 2 + 0.02)], LAWN_LIFT, new THREE.Color(T.ground[3]!).multiplyScalar(1.05), terrain);
  const [r0, r1] = s.bed;
  fillOnTerrain(mb, [ring(s.tree.x, s.tree.y, r1, 32), ring(s.tree.x, s.tree.y, r0, 24).reverse()], LAWN_LIFT + 0.02, SOIL, terrain);
}

/** Bordure, fleurs, arbustes et arbre (maillage plein de la tuile). */
export function buildRoundabout(mb: MeshBuilder, s: RoundaboutSite, terrain: HeightField): void {
  const [cx, cy] = s.c;
  const P = (x: number, y: number, z: number): Vec3 => toThree(x, y, z);
  const h = (x: number, y: number): number => terrain.heightAt(x, y);

  // Bordure : anneau bas de `curb` de large, faces intérieure et extérieure, dessus.
  const ri = s.r - s.curb / 2, ro = s.r + s.curb / 2;
  for (let i = 0; i < SEG; i++) {
    const a0 = (2 * Math.PI * i) / SEG, a1 = (2 * Math.PI * (i + 1)) / SEG, am = (a0 + a1) / 2;
    const p = (r: number, a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [o0, o1, i0, i1] = [p(ro, a0), p(ro, a1), p(ri, a0), p(ri, a1)];
    const z = (q: [number, number], k: number): number => h(...q) + k;
    mb.quad(P(...o0, z(o0, -0.1)), P(...o1, z(o1, -0.1)), P(...o1, z(o1, CURB_TOP)), P(...o0, z(o0, CURB_TOP)), toThree(Math.cos(am), Math.sin(am), 0), shade(CURB, 0.86));
    mb.quad(P(...i0, z(i0, LAWN_LIFT - 0.02)), P(...i1, z(i1, LAWN_LIFT - 0.02)), P(...i1, z(i1, CURB_TOP)), P(...i0, z(i0, CURB_TOP)), toThree(-Math.cos(am), -Math.sin(am), 0), shade(CURB, 0.8));
    mb.quad(P(...o0, z(o0, CURB_TOP)), P(...o1, z(o1, CURB_TOP)), P(...i1, z(i1, CURB_TOP)), P(...i0, z(i0, CURB_TOP)), [0, 1, 0], CURB);
  }

  // Massif : fleurs en petits coussins de couleur, semées sur l'anneau autour du tronc ; arbustes bas en dômes à facettes.
  const { x: tx, y: ty } = s.tree;
  const [r0, r1] = s.bed;
  const n = Math.round((Math.PI * (r1 * r1 - r0 * r0)) / 0.35);
  for (let k = 0; k < n; k++) {
    const a = rnd(k) * 2 * Math.PI, r = Math.sqrt(r0 * r0 + rnd(k + 0.5) * (r1 * r1 - r0 * r0)), w = 0.12 + 0.1 * rnd(k + 0.7);
    const x = tx + r * Math.cos(a), y = ty + r * Math.sin(a), z = h(x, y) + LAWN_LIFT + 0.02;
    const col = C(s.flowers[Math.floor(rnd(k + 0.9) * s.flowers.length)]!);
    const top = P(x, y, z + 0.18 + 0.12 * rnd(k + 1.1));
    for (let j = 0; j < 3; j++) {
      const b0 = a + (2 * Math.PI * j) / 3, b1 = a + (2 * Math.PI * (j + 1)) / 3;
      mb.tri(P(x + w * Math.cos(b0), y + w * Math.sin(b0), z), P(x + w * Math.cos(b1), y + w * Math.sin(b1), z), top, toThree(Math.cos(b0 + Math.PI / 3), Math.sin(b0 + Math.PI / 3), 0.6), shade(col, 0.9 + 0.15 * (j % 2)));
    }
  }
  for (let k = 0; k < 6; k++) {
    const a = (2 * Math.PI * (k + rnd(k * 3) * 0.5)) / 6, r = r1 + 0.6;
    dome(mb, tx + r * Math.cos(a), ty + r * Math.sin(a), h(tx + r * Math.cos(a), ty + r * Math.sin(a)) + LAWN_LIFT, 0.55 + 0.25 * rnd(k), 0.7 + 0.2 * rnd(k + 2), shade(SHRUB, 0.9 + 0.2 * rnd(k + 4)));
  }

  // Cèdre : tronc conique jusqu'aux deux tiers, plateaux étagés aux rayons mesurés.
  const g = h(tx, ty);
  const tiers = s.tree.tiers;
  const trunkTop = s.tree.top * 0.82;
  for (let i = 0; i < 8; i++) {
    const a0 = (2 * Math.PI * i) / 8, a1 = (2 * Math.PI * (i + 1)) / 8, am = (a0 + a1) / 2;
    const rb = TRUNK_R, rt = TRUNK_R * 0.35;
    mb.quad(P(tx + rb * Math.cos(a0), ty + rb * Math.sin(a0), g - 0.2), P(tx + rb * Math.cos(a1), ty + rb * Math.sin(a1), g - 0.2),
      P(tx + rt * Math.cos(a1), ty + rt * Math.sin(a1), g + trunkTop), P(tx + rt * Math.cos(a0), ty + rt * Math.sin(a0), g + trunkTop),
      toThree(Math.cos(am), Math.sin(am), 0.1), shade(BARK, 0.85 + 0.15 * Math.max(0, Math.cos(am - 2.4))));
  }
  // Rayon de la couronne mesuré à la hauteur z (interpolé entre les paliers).
  const radiusAt = (z: number): number => {
    if (z <= tiers[0]![0]) return tiers[0]![1];
    for (let i = 0; i + 1 < tiers.length; i++) {
      const [z0, q0] = tiers[i]!, [z1, q1] = tiers[i + 1]!;
      if (z <= z1) return q0 + ((q1 - q0) * (z - z0)) / (z1 - z0);
    }
    return 0.6;
  };
  // Étages de branches tous les 1,6 m à partir de 2 m (branches basses jusqu'au massif) : chacun fait de trois ou quatre plateaux
  // irréguliers décalés autour du tronc, dont l'ensemble atteint le rayon mesuré à cette hauteur ; trous sombres entre les étages.
  let k = 0;
  for (let z = 2.0; z < s.tree.top - 1.6; z += 1.6, k++) {
    const R = radiusAt(z + 0.7);
    const m = R > 4 ? 4 : 3;
    for (let j = 0; j < m; j++) {
      const a = (2 * Math.PI * (j + rnd(k * 7 + j))) / m + k * 1.3, off = R * (0.22 + 0.12 * rnd(k * 11 + j));
      const rr = (R - off) * 1.05;
      plate(mb, tx + off * Math.cos(a), ty + off * Math.sin(a), g + z + 0.35 * rnd(k * 5 + j) - 0.15, rr, 0.9 + 0.5 * rnd(k * 13 + j), k * 10 + j);
    }
  }
  // Pointe arrondie.
  dome(mb, tx, ty, g + s.tree.top - 2.2, Math.max(1.5, radiusAt(s.tree.top - 1.5) * 0.75), 2.2, NEEDLES_TOP);
}

/** Plateau de branches : polygone irrégulier (échancré), épais de `th`, dessus en cône aplati plus clair, bords qui retombent, dessous sombre. */
function plate(mb: MeshBuilder, x: number, y: number, z: number, R: number, th: number, seed: number): void {
  const n = 11;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.4 * rnd(seed * 31 + i))) / n + seed * 0.7;
    const r = R * (0.72 + 0.33 * rnd(seed * 17 + i));
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  const top = shade(NEEDLES_TOP, 0.88 + 0.18 * rnd(seed)), side = shade(NEEDLES, 0.9 + 0.15 * rnd(seed + 3)), under = shade(NEEDLES, 0.45);
  const zc = z + th, ze = z + th * 0.25;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!;
    const mx = (p[0] + q[0]) / 2 - x, my = (p[1] + q[1]) / 2 - y, ml = Math.hypot(mx, my) || 1;
    // Dessus légèrement bombé vers le tronc, bord, dessous.
    mb.tri(toThree(x, y, zc), toThree(p[0], p[1], ze), toThree(q[0], q[1], ze), [0, 1, 0], top);
    mb.quad(toThree(p[0], p[1], z - 0.15), toThree(q[0], q[1], z - 0.15), toThree(q[0], q[1], ze), toThree(p[0], p[1], ze), toThree(mx / ml, my / ml, 0.3), side);
    mb.tri(toThree(x, y, z + th * 0.3), toThree(q[0], q[1], z - 0.15), toThree(p[0], p[1], z - 0.15), [0, -1, 0], under);
  }
}

/** Dôme à facettes (arbuste, pointe du cèdre). */
function dome(mb: MeshBuilder, x: number, y: number, z: number, r: number, hgt: number, col: THREE.Color): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n, am = (a0 + a1) / 2;
    const p0 = toThree(x + r * Math.cos(a0), y + r * Math.sin(a0), z), p1 = toThree(x + r * Math.cos(a1), y + r * Math.sin(a1), z);
    const m0 = toThree(x + r * 0.7 * Math.cos(a0), y + r * 0.7 * Math.sin(a0), z + hgt * 0.6), m1 = toThree(x + r * 0.7 * Math.cos(a1), y + r * 0.7 * Math.sin(a1), z + hgt * 0.6);
    mb.quad(p0, p1, m1, m0, toThree(Math.cos(am), Math.sin(am), 0.5), shade(col, 0.9 + 0.1 * Math.max(0, Math.cos(am - 2.4))));
    mb.tri(m0, m1, toThree(x, y, z + hgt), toThree(Math.cos(am) * 0.4, Math.sin(am) * 0.4, 1), shade(col, 1.08));
  }
}
