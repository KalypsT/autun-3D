/**
 * Poses sur véhicule (vélo, moto, trottinette) du personnage : le bassin est posé sur la selle (ou entre les pieds), les mains
 * vont aux poignées et les pieds aux pédales ou aux repose-pieds par cinématique inverse à deux segments. Logique pure.
 *
 * Analogie : un marionnettiste qui tient le bassin et les quatre extrémités ; les coudes et les genoux se plient d'eux-mêmes,
 * du côté où on leur dit de se plier (le « pôle »).
 */

import type { BodyDims } from "./character";
import { BONE, REF_DIMS, solveBones, type Pose, type Root } from "./character-rig";

export type V3 = readonly [number, number, number];
export type RideStyle = "pedal" | "seat" | "stand";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Résultat de la cinématique inverse : coude (ou genou) et extrémité atteinte. */
export interface Chain {
  mid: V3;
  end: V3;
}

/**
 * Deux segments de longueurs `l1` et `l2` partant de `root` vers `target` ; le coude est du côté de `pole` (une direction, pas un point).
 * Une cible hors de portée est ramenée sur le segment : la chaîne se tend en direction de la cible.
 */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3): Chain {
  const to = sub(target, root);
  const dist = Math.min(Math.max(len(to), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const dir = unit(to);
  // Distance le long de l'axe jusqu'au pied de la hauteur du triangle, puis hauteur (théorème d'Al-Kashi).
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let perp = sub(pole, mul(dir, dot(pole, dir)));
  if (len(perp) < 1e-6) perp = sub([0, 0, -1], mul(dir, dir[2] * -1));
  perp = unit(perp);
  const mid = add(add(root, mul(dir, a)), mul(perp, h));
  return { mid, end: add(root, mul(dir, dist)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rotations 3 × 3 (colonnes), convention de character-rig : R = Ry·Rx·Rz.

type M3 = Float64Array;

function rot3(rx: number, ry: number, rz: number, m: M3 = new Float64Array(9)): M3 {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  m[0] = cy * cz + sy * sx * sz; m[1] = cx * sz; m[2] = -sy * cz + cy * sx * sz;
  m[3] = -cy * sz + sy * sx * cz; m[4] = cx * cz; m[5] = sy * sz + cy * sx * cz;
  m[6] = sy * cx; m[7] = -sx; m[8] = cy * cx;
  return m;
}

function mul3(a: M3, b: M3, out: M3 = new Float64Array(9)): M3 {
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) out[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
  }
  return out;
}

/** Transposée de a (= inverse d'une rotation) appliquée à v. */
function applyT(a: M3, v: V3): V3 {
  return [a[0]! * v[0] + a[1]! * v[1] + a[2]! * v[2], a[3]! * v[0] + a[4]! * v[1] + a[5]! * v[2], a[6]! * v[0] + a[7]! * v[1] + a[8]! * v[2]];
}

function worldRot(world: Float32Array, bone: number, out: M3): M3 {
  const o = bone * 16;
  out[0] = world[o]!; out[1] = world[o + 1]!; out[2] = world[o + 2]!;
  out[3] = world[o + 4]!; out[4] = world[o + 5]!; out[5] = world[o + 6]!;
  out[6] = world[o + 8]!; out[7] = world[o + 9]!; out[8] = world[o + 10]!;
  return out;
}

const worldPos = (world: Float32Array, bone: number): V3 => [world[bone * 16 + 12]!, world[bone * 16 + 13]!, world[bone * 16 + 14]!];

/** Angles (rx, rz) qui tournent un os pendant (0, −1, 0) vers la direction locale `v` (sans torsion). */
function aim(v: V3): [number, number] {
  return [Math.atan2(-v[2], -v[1]), Math.asin(Math.min(Math.max(v[0], -1), 1))];
}

/** Angles (rx, ry, rz) d'une rotation Ry·Rx·Rz. */
export function eulerYXZ(m: M3): [number, number, number] {
  return [Math.asin(Math.min(Math.max(-m[7]!, -1), 1)), Math.atan2(m[6]!, m[8]!), Math.atan2(m[1]!, m[4]!)];
}

const R1 = new Float64Array(9), R2 = new Float64Array(9), R3 = new Float64Array(9), R4 = new Float64Array(9);

/**
 * Pose un membre à deux segments : écrit les angles de `upper` et `lower` dans `pose` pour que le bout du second segment
 * (à `reach` de l'articulation du milieu) atteigne `target`. `world` : matrices monde calculées avec ce membre au repos (les os parents
 * ne dépendent que d'eux-mêmes). Renvoie la rotation monde du second segment.
 */
function poseLimb(pose: Pose, world: Float32Array, parent: number, upper: number, lower: number, l1: number, reach: number, target: V3, pole: V3): M3 {
  const root = worldPos(world, upper);
  const chain = twoBone(root, target, l1, reach, pole);
  const rp = worldRot(world, parent, R1);
  const [b1, a1] = aim(applyT(rp, unit(sub(chain.mid, root))));
  pose.angles[upper * 3] = b1;
  pose.angles[upper * 3 + 1] = 0;
  pose.angles[upper * 3 + 2] = a1;
  const ru = mul3(rp, rot3(b1, 0, a1, R2), R3);
  const [b2, a2] = aim(applyT(ru, unit(sub(chain.end, chain.mid))));
  pose.angles[lower * 3] = b2;
  pose.angles[lower * 3 + 1] = 0;
  pose.angles[lower * 3 + 2] = a2;
  return mul3(ru, rot3(b2, 0, a2, R2), R4);
}

/** Points d'appui d'un véhicule, dans son repère : selle, poignées (gauche, droite) et pieds (point où l'avant-pied touche), gauche puis droit. */
export interface RideAnchors {
  seat: V3;
  grips: readonly [V3, V3];
  feet: readonly [V3, V3];
}

/** Distance (m) de la cheville à l'appui de la plante (le pied pose sur l'avant-pied, la cheville est derrière). */
export function ballOffset(d: BodyDims): number {
  return 0.09 * (d.height / REF_DIMS.height);
}

/** Longueur du bras de l'épaule au centre de la main (le dessin de la main prolonge l'avant-bras de 4,5 cm de référence). */
export function handReach(d: BodyDims): number {
  const k = d.forearm / REF_DIMS.forearm;
  return d.forearm + 0.045 * k;
}

/**
 * Pose complète sur un véhicule. `crankless` : les pieds suivent déjà les pédales par leurs points d'appui, sans autre calcul.
 * `out` reçoit les matrices de rendu des os (13 × 16) ; `world`, un espace de travail du même format.
 * Le bassin est posé sur la selle ; pour `stand`, il est entre les pieds, jambes presque tendues.
 */
export function solveRide(
  out: Float32Array, world: Float32Array, offsets: Float32Array, scales: Float32Array,
  d: BodyDims, style: RideStyle, anchors: RideAnchors, pose: Pose,
): void {
  const a = pose.angles;
  a.fill(0);
  const stoop = d.stoop - 0.02;
  let pelvis: V3;
  if (style === "stand") {
    // Debout de trois quarts sur le plateau : bassin tourné, torse qui revient vers le guidon, jambes presque tendues.
    const mid = mul(add(anchors.feet[0], anchors.feet[1]), 0.5);
    pelvis = [mid[0], mid[1] + (d.thigh + d.shin) * 0.95 + d.ankleY, mid[2]];
    a[BONE.pelvis * 3 + 1] = -0.55;
    a[BONE.torso * 3] = -0.1 - stoop;
    a[BONE.torso * 3 + 1] = 0.45;
    a[BONE.head * 3] = 0.08 + stoop;
    a[BONE.head * 3 + 1] = 0.1;
  } else {
    pelvis = [anchors.seat[0], anchors.seat[1] + 0.07 * (d.height / REF_DIMS.height), anchors.seat[2]];
    const lean = style === "pedal" ? 0.32 : 0.2;
    a[BONE.pelvis * 3] = style === "pedal" ? -0.1 : -0.05;
    a[BONE.torso * 3] = -lean - stoop;
    a[BONE.head * 3] = lean * 0.9 + stoop + (style === "pedal" ? 0.1 : 0.05);
  }
  pose.rootDy = -d.hipY;
  const root: Root = { x: pelvis[0], y: pelvis[1], z: pelvis[2], yaw: 0 };
  solveBones(out, world, offsets, scales, pose, root);

  // Bras : épaule (os du bras) vers la poignée, coude vers l'extérieur et le bas ; jambes : hanche vers la cheville (pied à plat sur l'appui), genou vers l'avant.
  const reach = handReach(d);
  const ankle = (foot: V3): V3 => [foot[0], foot[1] + d.ankleY, foot[2] + ballOffset(d)];
  poseLimb(pose, world, BONE.torso, BONE.armL, BONE.forearmL, d.upperArm, reach, anchors.grips[0], [-0.6, -0.5, 0.3]);
  poseLimb(pose, world, BONE.torso, BONE.armR, BONE.forearmR, d.upperArm, reach, anchors.grips[1], [0.6, -0.5, 0.3]);
  const flat = rot3(0, 0, 0, new Float64Array(9));
  for (const [thigh, shin, foot, side, target] of [
    [BONE.thighL, BONE.shinL, BONE.footL, -1, anchors.feet[0]],
    [BONE.thighR, BONE.shinR, BONE.footR, 1, anchors.feet[1]],
  ] as const) {
    const rs = poseLimb(pose, world, BONE.pelvis, thigh, shin, d.thigh, d.shin, ankle(target), [side * 0.15, 0.2, -1]);
    // Le pied reste à plat : rotation locale = (rotation du mollet)⁻¹ × rotation voulue (plate).
    const local = mul3(transpose(rs), flat);
    const [rx, ry, rz] = eulerYXZ(local);
    a[foot * 3] = rx;
    a[foot * 3 + 1] = ry;
    a[foot * 3 + 2] = rz;
  }
  solveBones(out, world, offsets, scales, pose, root);
}

function transpose(m: M3): M3 {
  const t = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t[c * 3 + r] = m[r * 3 + c]!;
  return t;
}

