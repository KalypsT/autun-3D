/**
 * Squelette du personnage (13 os), pose de marche et calcul des matrices d'os (D37). Logique pure : aucun rendu ici.
 * Les trois approches de rendu comparées à l'étape P (peau, instances à shader, pièces groupées) consomment les mêmes matrices
 * et la même pose, pour que la comparaison ne porte que sur le coût de dessin.
 *
 * Conventions : le personnage regarde vers −z (sa droite est +x), y vers le haut. Un os tourne autour de son articulation ;
 * une rotation `rx` positive porte un membre pendant vers l'avant. Les échelles d'une recette (corpulence, taille) ne se transmettent
 * pas aux os enfants : chaque os met à l'échelle sa seule géométrie, et ce sont les décalages d'articulation (calculés
 * d'après `bodyDims`) qui placent les membres. Aucun cisaillement, même avec un torse large et un bras plié.
 */

import { bodyDims, DEFAULT_RECIPE, type BodyDims, type Recipe } from "./character";

export const BONES = ["pelvis", "torso", "head", "armL", "forearmL", "armR", "forearmR", "thighL", "shinL", "thighR", "shinR", "footL", "footR"] as const;
export const BONE_COUNT = BONES.length;
export const BONE = {
  pelvis: 0, torso: 1, head: 2, armL: 3, forearmL: 4, armR: 5, forearmR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10, footL: 11, footR: 12,
} as const;
/** Os parent (−1 pour la racine). Un parent précède toujours son enfant. */
export const PARENT: readonly number[] = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 8, 10];

/** Corps de référence : la géométrie du catalogue est dessinée à cette taille, puis mise à l'échelle par recette. */
export const REF_RECIPE: Recipe = { ...DEFAULT_RECIPE, sex: "m", age: "adult", height: 1.75, build: "average" };
export const REF_DIMS: BodyDims = bodyDims(REF_RECIPE);

/** Angles (rad) de chaque os autour de x, y, z, et décalage vertical du bassin qui garde le pied le plus bas au sol. */
export interface Pose {
  angles: Float32Array;
  rootDy: number;
}

export function createPose(): Pose {
  return { angles: new Float32Array(BONE_COUNT * 3), rootDy: 0 };
}

export interface Root {
  /** Position au sol (repère three : x, hauteur, z) et cap (rad, rotation autour de y). */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Longueur d'un cycle de marche complet (deux pas, m) : elle croît avec la vitesse (la foulée s'allonge en courant). */
export function cycleLength(speed: number, height: number): number {
  return height * (0.86 + 0.18 * Math.max(0, speed - 1.4));
}

/** Vitesse de la phase de marche (rad/s) pour une vitesse au sol donnée. */
export function phaseRate(speed: number, height: number): number {
  return (2 * Math.PI * speed) / cycleLength(speed, height);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Pose de marche ou de course à la phase `phase` (rad ; 0 à 2π = un cycle de deux pas) et à la vitesse `speed` (m/s).
 * À l'arrêt (vitesse nulle) : debout, bras le long du corps. Les pieds restent au sol (`rootDy`).
 */
export function walkPose(pose: Pose, phase: number, speed: number, d: BodyDims): void {
  const a = pose.angles;
  const w = clamp(speed / 1.4, 0, 1);
  const r = clamp((speed - 2.4) / 3, 0, 1);
  const swing = 0.42 * w + 0.3 * r;
  const stoop = d.stoop + 0.04 * w + 0.14 * r;
  a.fill(0);
  const sL = Math.sin(phase), sR = -sL;
  const leg = (thigh: number, shin: number, foot: number, s: number, c: number): number => {
    const th = 0.1 * w + swing * s;
    // La jambe plie surtout quand la cuisse passe vers l'avant.
    const k = clamp(w * 0.12 + (0.5 * w + 0.5 * r) * Math.max(0, c) ** 1.5, 0, 2.2);
    a[thigh * 3] = th;
    a[shin * 3] = -k;
    a[foot * 3] = clamp(0.9 * (k - th), -0.6, 0.6);
    return d.thigh * Math.cos(th) + d.shin * Math.cos(th - k);
  };
  const eL = leg(BONE.thighL, BONE.shinL, BONE.footL, sL, Math.cos(phase + 0.3));
  const eR = leg(BONE.thighR, BONE.shinR, BONE.footR, sR, Math.cos(phase + Math.PI + 0.3));
  pose.rootDy = Math.max(eL, eR) - (d.thigh + d.shin);

  // Bras : en opposition aux jambes, coudes fléchis surtout vers l'avant, un peu écartés du corps.
  const armSwing = 0.5 * w + 0.45 * r;
  a[BONE.armL * 3] = -armSwing * sL + 0.04;
  a[BONE.armR * 3] = -armSwing * sR + 0.04;
  a[BONE.armL * 3 + 2] = -0.08;
  a[BONE.armR * 3 + 2] = 0.08;
  a[BONE.forearmL * 3] = 0.12 + 0.18 * w + 1.0 * r + 0.2 * w * (0.5 - 0.5 * sL);
  a[BONE.forearmR * 3] = 0.12 + 0.18 * w + 1.0 * r + 0.2 * w * (0.5 - 0.5 * sR);

  // Buste : penché vers l'avant (avance plus en courant, voûté chez les seniors) et en torsion inverse du bassin ; tête qui compense.
  a[BONE.pelvis * 3 + 1] = -0.08 * w * sL;
  a[BONE.torso * 3] = -stoop;
  a[BONE.torso * 3 + 1] = 0.12 * w * sL;
  a[BONE.head * 3] = 0.7 * stoop;
  a[BONE.head * 3 + 1] = -0.5 * a[BONE.torso * 3 + 1]!;
}

/** Décalages d'articulation au repos (m), de chaque os par rapport à son parent, dans le repère du parent. 13 × 3 valeurs. */
export function restOffsets(d: BodyDims, out: Float32Array = new Float32Array(BONE_COUNT * 3)): Float32Array {
  const set = (bone: number, x: number, y: number, z: number): void => {
    out[bone * 3] = x;
    out[bone * 3 + 1] = y;
    out[bone * 3 + 2] = z;
  };
  const shoulderY = d.shoulderY - 0.025 * d.height - d.hipY;
  set(BONE.pelvis, 0, d.hipY, 0);
  set(BONE.torso, 0, 0, 0);
  set(BONE.head, 0, d.neckY - 0.015 * d.height - d.hipY, 0);
  set(BONE.armL, -d.shoulderHalf, shoulderY, 0);
  set(BONE.armR, d.shoulderHalf, shoulderY, 0);
  set(BONE.forearmL, 0, -d.upperArm, 0);
  set(BONE.forearmR, 0, -d.upperArm, 0);
  set(BONE.thighL, -d.stance, 0, 0);
  set(BONE.thighR, d.stance, 0, 0);
  set(BONE.shinL, 0, -d.thigh, 0);
  set(BONE.shinR, 0, -d.thigh, 0);
  set(BONE.footL, 0, -d.shin, 0);
  set(BONE.footR, 0, -d.shin, 0);
  return out;
}

/** Échelle (x, y, z) de la géométrie de chaque os par rapport au corps de référence. 13 × 3 valeurs. */
export function geometryScales(d: BodyDims, out: Float32Array = new Float32Array(BONE_COUNT * 3)): Float32Array {
  const ref = REF_DIMS;
  const set = (bone: number, x: number, y: number, z: number): void => {
    out[bone * 3] = x;
    out[bone * 3 + 1] = y;
    out[bone * 3 + 2] = z;
  };
  const s = d.height / ref.height;
  const rr = d.limbRadius / ref.limbRadius;
  const depth = d.torsoDepth / ref.torsoDepth;
  const chest = (d.shoulderHalf + d.waistHalf) / (ref.shoulderHalf + ref.waistHalf);
  set(BONE.pelvis, d.hipHalf / ref.hipHalf, s, depth);
  set(BONE.torso, chest, d.torso / ref.torso, depth);
  const h = d.headRadius / ref.headRadius;
  set(BONE.head, h, h, h);
  for (const [upper, fore] of [[BONE.armL, BONE.forearmL], [BONE.armR, BONE.forearmR]] as const) {
    set(upper, rr, d.upperArm / ref.upperArm, rr);
    set(fore, rr, d.forearm / ref.forearm, rr);
  }
  for (const [thigh, shin, foot] of [[BONE.thighL, BONE.shinL, BONE.footL], [BONE.thighR, BONE.shinR, BONE.footR]] as const) {
    set(thigh, rr, d.thigh / ref.thigh, rr);
    set(shin, rr, d.shin / ref.shin, rr);
    set(foot, s, s, s);
  }
  return out;
}

/** Rotation Ry·Rx·Rz en 3 × 3 (colonnes), écrite dans `m`. */
function rotation(m: Float64Array, rx: number, ry: number, rz: number): void {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Lignes r0, r1, r2 ; stockage par colonnes.
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  m[0] = r00; m[1] = r10; m[2] = r20;
  m[3] = r01; m[4] = r11; m[5] = r21;
  m[6] = r02; m[7] = r12; m[8] = r22;
}

const rot = new Float64Array(9);

/**
 * Calcule les matrices 4 × 4 (colonnes) de rendu de chaque os : monde × échelle de géométrie. `out` : 13 × 16 valeurs.
 * `world` est un espace de travail de 13 × 16 valeurs (les matrices sans échelle, utiles aux tests et aux accessoires).
 */
export function solveBones(out: Float32Array, world: Float32Array, offsets: Float32Array, scales: Float32Array, pose: Pose, root: Root): void {
  const a = pose.angles;
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = b * 16;
    rotation(rot, a[b * 3]!, a[b * 3 + 1]!, a[b * 3 + 2]!);
    const ox = offsets[b * 3]!, oy = offsets[b * 3 + 1]! + (b === 0 ? pose.rootDy : 0), oz = offsets[b * 3 + 2]!;
    const p = PARENT[b]!;
    if (p < 0) {
      // Racine : translation au sol, cap, puis décalage du bassin.
      const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
      // Ry(yaw) × R : lignes de Ry = (c, 0, s), (0, 1, 0), (−s, 0, c).
      for (let j = 0; j < 3; j++) {
        const x = rot[j * 3]!, y = rot[j * 3 + 1]!, z = rot[j * 3 + 2]!;
        world[o + j * 4] = c * x + s * z;
        world[o + j * 4 + 1] = y;
        world[o + j * 4 + 2] = -s * x + c * z;
        world[o + j * 4 + 3] = 0;
      }
      world[o + 12] = root.x + c * ox + s * oz;
      world[o + 13] = root.y + oy;
      world[o + 14] = root.z - s * ox + c * oz;
      world[o + 15] = 1;
    } else {
      const q = p * 16;
      for (let j = 0; j < 3; j++) {
        const x = rot[j * 3]!, y = rot[j * 3 + 1]!, z = rot[j * 3 + 2]!;
        world[o + j * 4] = world[q]! * x + world[q + 4]! * y + world[q + 8]! * z;
        world[o + j * 4 + 1] = world[q + 1]! * x + world[q + 5]! * y + world[q + 9]! * z;
        world[o + j * 4 + 2] = world[q + 2]! * x + world[q + 6]! * y + world[q + 10]! * z;
        world[o + j * 4 + 3] = 0;
      }
      world[o + 12] = world[q]! * ox + world[q + 4]! * oy + world[q + 8]! * oz + world[q + 12]!;
      world[o + 13] = world[q + 1]! * ox + world[q + 5]! * oy + world[q + 9]! * oz + world[q + 13]!;
      world[o + 14] = world[q + 2]! * ox + world[q + 6]! * oy + world[q + 10]! * oz + world[q + 14]!;
      world[o + 15] = 1;
    }
    // Rendu : monde × échelle de la géométrie de l'os.
    const sx = scales[b * 3]!, sy = scales[b * 3 + 1]!, sz = scales[b * 3 + 2]!;
    for (let i = 0; i < 4; i++) {
      out[o + i] = world[o + i]! * sx;
      out[o + 4 + i] = world[o + 4 + i]! * sy;
      out[o + 8 + i] = world[o + 8 + i]! * sz;
    }
    out[o + 12] = world[o + 12]!;
    out[o + 13] = world[o + 13]!;
    out[o + 14] = world[o + 14]!;
    out[o + 15] = 1;
  }
}
