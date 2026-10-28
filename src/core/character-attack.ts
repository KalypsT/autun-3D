/**
 * Poses d'attaque du personnage (J5-1, D80) : garde d'un personnage armé et gestes de coup (poing, estoc, balayage). Elles s'appliquent PAR-DESSUS
 * la pose de marche (`walkPose`) : les jambes continuent de marcher, seuls les bras, le buste et la tête sont repris. Aucun os sous le sol : le
 * bassin ne bouge pas.
 *
 * Analogie : un mime qui garde sa marche mais ne joue le coup qu'avec le haut du corps. Un coup est une courte suite d'images clés (garde, armé,
 * frappe, suivi, garde) lissées entre elles ; on fond dans la pose de marche au début et à la fin pour qu'il n'y ait pas de saut.
 *
 * Convention de `character-rig.ts` : une rotation `rx` positive porte un membre vers l'avant ; `ry` positive du buste tourne vers la gauche du
 * personnage (le visage regarde −z, sa droite est +x).
 */

import { BONE, type Pose } from "./character-rig";
import type { AttackStyle } from "./weapons";

/** Angles d'une image clé : bras d'attaque (x, z), avant-bras (x), buste (x en plus, torsion y), bassin (torsion y). */
type Key = readonly [number, number, number, number, number, number];

const GUARD: Record<AttackStyle, Key> = {
  punch: [0.55, 0.05, 1.45, 0.05, 0, 0],
  stab: [0.55, 0.05, 1.15, 0.03, 0, 0],
  swing: [0.75, 0.05, 1.0, 0.03, 0, 0],
};

/** Images clés d'un coup : garde, armé, frappe, suivi, retour en garde (la frappe tombe à `hitAt` de la durée). */
const KEYS: Record<AttackStyle, readonly [Key, Key, Key, Key]> = {
  punch: [[0.2, 0.05, 1.95, 0.0, -0.35, -0.1], [1.45, 0.02, 0.12, 0.16, 0.4, 0.12], [1.3, 0.02, 0.3, 0.1, 0.28, 0.08], GUARD.punch],
  stab: [[0.3, 0.05, 1.95, 0.0, -0.28, -0.08], [1.35, 0.02, 0.2, 0.14, 0.32, 0.1], [1.2, 0.02, 0.4, 0.1, 0.22, 0.06], GUARD.stab],
  // La batte touche en plein balayage (la torsion passe par le milieu à la frappe) et finit son geste de l'autre côté.
  swing: [[1.0, 0.45, 1.3, 0.0, -0.95, -0.28], [1.35, 0.05, 0.5, 0.12, 0.15, 0.05], [1.2, 0.05, 0.6, 0.1, 1.1, 0.32], GUARD.swing],
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const smooth = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Poids (0 à 1) de la pose d'attaque : fondu d'entrée et de sortie. */
export const attackBlend = (u: number): number => smooth(u / 0.16) * smooth((1 - u) / 0.22);

/** Image interpolée du coup à la progression `u` (0 à 1), la frappe tombant à `hitAt`. */
export function attackKey(style: AttackStyle, u: number, hitAt: number, out: number[] = [0, 0, 0, 0, 0, 0]): number[] {
  const [wind, strike, follow, back] = KEYS[style];
  const g = GUARD[style];
  const h = clamp(hitAt, 0.2, 0.8);
  // Segments : garde → armé (0 à 0,5 h), armé → frappe (0,5 h à h), frappe → suivi (h à h + 35 % du reste), suivi → garde.
  const t1 = h * 0.5, t3 = h + (1 - h) * 0.35;
  let a: Key, b: Key, k: number;
  if (u < t1) [a, b, k] = [g, wind, smooth(u / t1)];
  else if (u < h) [a, b, k] = [wind, strike, smooth((u - t1) / (h - t1))];
  else if (u < t3) [a, b, k] = [strike, follow, smooth((u - h) / (t3 - h))];
  else [a, b, k] = [follow, back, smooth((u - t3) / (1 - t3))];
  for (let i = 0; i < 6; i++) out[i] = a[i]! + (b[i]! - a[i]!) * k;
  return out;
}

const KEY = [0, 0, 0, 0, 0, 0];

/**
 * Garde d'un personnage armé (arme blanche en main droite) : le bras droit plié devant, l'arme pointant vers l'avant. `w` (0 à 1) dose le fondu.
 * À appeler après `walkPose`.
 */
export function guardPose(pose: Pose, style: AttackStyle, w = 1): void {
  const a = pose.angles, g = GUARD[style];
  const mix = (idx: number, v: number): void => {
    a[idx] = a[idx]! + (v - a[idx]!) * w;
  };
  mix(BONE.armR * 3, g[0]);
  mix(BONE.armR * 3 + 2, g[1]);
  mix(BONE.forearmR * 3, g[2]);
}

/**
 * Geste de coup à la progression `u` (0 à 1) d'un coup de durée donnée, `side` +1 : bras droit, −1 : bras gauche (poings qui alternent).
 * À appeler après `walkPose` (et après `guardPose` : les poings, eux, lèvent aussi l'autre bras en garde).
 */
export function attackPose(pose: Pose, style: AttackStyle, u: number, hitAt: number, side: 1 | -1): void {
  const a = pose.angles;
  const w = attackBlend(u);
  if (w <= 0) return;
  const k = attackKey(style, u, hitAt, KEY);
  const arm = side > 0 ? BONE.armR : BONE.armL, fore = side > 0 ? BONE.forearmR : BONE.forearmL;
  const mix = (idx: number, v: number): void => {
    a[idx] = a[idx]! + (v - a[idx]!) * w;
  };
  mix(arm * 3, k[0]!);
  mix(arm * 3 + 2, side * k[1]!);
  mix(fore * 3, k[2]!);
  a[BONE.torso * 3] = a[BONE.torso * 3]! + k[3]! * w;
  // La torsion se retourne avec le côté du poing : le poing gauche s'arme vers la gauche.
  a[BONE.torso * 3 + 1] = a[BONE.torso * 3 + 1]! + side * k[4]! * w;
  a[BONE.pelvis * 3 + 1] = a[BONE.pelvis * 3 + 1]! + side * k[5]! * w;
  if (style === "punch") {
    // L'autre poing reste en garde devant le visage.
    const other = side > 0 ? BONE.armL : BONE.armR, otherFore = side > 0 ? BONE.forearmL : BONE.forearmR;
    mix(other * 3, 0.6);
    mix(other * 3 + 2, side > 0 ? -0.1 : 0.1);
    mix(otherFore * 3, 1.5);
  }
}
