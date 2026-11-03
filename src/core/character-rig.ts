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
  /** Déport latéral du bassin (m, vers +x : la droite du personnage) : en marchant, il se porte sur la jambe d'appui. */
  rootDx: number;
}

export function createPose(): Pose {
  return { angles: new Float32Array(BONE_COUNT * 3), rootDy: 0, rootDx: 0 };
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
 * Courbes d'un cycle de marche (D100), d'après les relevés de la marche humaine : `u` va de 0 (pose du talon de cette jambe) à 1.
 * Hanche : flexion (+, cuisse vers l'avant) ; genou : flexion (+) ; pied : inclinaison de la semelle par rapport au sol (+ : pointe levée).
 * En marchant : genou presque tendu à la pose du talon, légère flexion pour amortir, appui tendu, puis grande flexion pendant que la jambe
 * passe (le pied ne racle pas le sol) ; le pied se déroule du talon à la pointe. En courant : appui plus fléchi, genou très replié derrière.
 */
type Keys = readonly (readonly [number, number])[];
const HIP_WALK: Keys = [[0, 0.38], [0.12, 0.3], [0.3, 0.08], [0.5, -0.17], [0.62, -0.12], [0.75, 0.15], [0.88, 0.4]];
const KNEE_WALK: Keys = [[0, 0.06], [0.13, 0.3], [0.3, 0.12], [0.45, 0.12], [0.6, 0.6], [0.72, 1.05], [0.85, 0.45], [0.95, 0.08]];
const FOOT_WALK: Keys = [[0, 0.22], [0.08, 0], [0.42, 0], [0.52, -0.18], [0.62, -0.5], [0.72, -0.15], [0.85, 0.08], [0.95, 0.18]];
const HIP_RUN: Keys = [[0, 0.5], [0.15, 0.3], [0.35, -0.25], [0.45, -0.3], [0.6, 0.1], [0.8, 0.7], [0.92, 0.6]];
const KNEE_RUN: Keys = [[0, 0.3], [0.12, 0.65], [0.3, 0.35], [0.42, 0.6], [0.6, 1.9], [0.75, 1.4], [0.9, 0.5]];
const FOOT_RUN: Keys = [[0, 0.12], [0.1, 0], [0.28, -0.25], [0.4, -0.7], [0.55, -0.3], [0.8, 0.1], [0.92, 0.15]];

/** Courbe périodique (période 1) passant par les clés, lissée (Catmull-Rom). */
function cyclic(keys: Keys, u: number): number {
  const n = keys.length;
  u -= Math.floor(u);
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k]![0] <= u) i = k;
  const at = (k: number): readonly [number, number] => {
    const m = ((k % n) + n) % n;
    const lap = Math.floor(k / n);
    return [keys[m]![0] + lap, keys[m]![1]];
  };
  const [t0, p0] = at(i - 1), [t1, p1] = at(i), [t2, p2] = at(i + 1), [t3, p3] = at(i + 2);
  const uu = u < t1 ? u + 1 : u;
  const t = (uu - t1) / (t2 - t1);
  // Tangentes à pas non uniforme (Catmull-Rom sur les instants des clés).
  const m1 = ((p2 - p0) / (t2 - t0)) * (t2 - t1), m2 = ((p3 - p1) / (t3 - t1)) * (t2 - t1);
  const t2_ = t * t, t3_ = t2_ * t;
  return (2 * t3_ - 3 * t2_ + 1) * p1 + (t3_ - 2 * t2_ + t) * m1 + (-2 * t3_ + 3 * t2_) * p2 + (t3_ - t2_) * m2;
}

const legRot = new Float64Array(9), legTmp = new Float64Array(9), legAcc = new Float64Array(9);
/** m = a × b (3 × 3 par colonnes). */
function mul3(m: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) m[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
  }
}
/** Hauteur de la cheville sous le bassin (m, négative) pour la pose courante : bassin, cuisse, jambe (déport et bascule du bassin compris). */
function ankleBelowPelvis(a: Float32Array, thigh: number, shin: number, side: number, d: BodyDims): number {
  rotation(legAcc, a[BONE.pelvis * 3]!, a[BONE.pelvis * 3 + 1]!, a[BONE.pelvis * 3 + 2]!);
  const hipY = legAcc[1]! * side * d.stance;
  rotation(legRot, a[thigh * 3]!, a[thigh * 3 + 1]!, a[thigh * 3 + 2]!);
  mul3(legTmp, legAcc, legRot);
  const kneeY = hipY - legTmp[4]! * d.thigh;
  rotation(legRot, a[shin * 3]!, a[shin * 3 + 1]!, a[shin * 3 + 2]!);
  mul3(legAcc, legTmp, legRot);
  return kneeY - legAcc[4]! * d.shin;
}

/**
 * Pose de marche ou de course à la phase `phase` (rad ; 0 à 2π = un cycle de deux pas) et à la vitesse `speed` (m/s).
 * À la phase π/2, la cuisse gauche est au plus en avant : le talon gauche se pose. Le bassin bascule et se déporte sur la jambe d'appui,
 * les épaules tournent à l'inverse du bassin, la tête reste stable, les bras balancent avec un léger retard, coude plié vers l'avant.
 * À l'arrêt (vitesse nulle) : debout, bras le long du corps, coudes à peine pliés. Le pied le plus bas reste au sol (`rootDy`).
 */
export function walkPose(pose: Pose, phase: number, speed: number, d: BodyDims): void {
  const a = pose.angles;
  const w = clamp(speed / 1.4, 0, 1);
  const r = clamp((speed - 2.4) / 3, 0, 1);
  a.fill(0);
  const uL = phase / (2 * Math.PI) - 0.25;
  const mix = (walk: Keys, run: Keys, u: number): number => w * ((1 - r) * cyclic(walk, u) + r * cyclic(run, u));

  // Bassin : torsion (la hanche de la jambe qui avance part en avant), bascule (le côté de la jambe qui passe descend) et déport sur l'appui.
  const support = Math.sin(2 * Math.PI * uL);
  const roll = -0.045 * w * (1 - 0.5 * r) * support;
  const shift = -0.022 * w * (1 - 0.6 * r) * support;
  a[BONE.pelvis * 3 + 1] = -(0.07 + 0.05 * r) * w * Math.sin(phase);
  a[BONE.pelvis * 3 + 2] = roll;
  pose.rootDx = shift;

  const legLen = d.thigh + d.shin;
  for (const [thigh, shin, foot, u] of [[BONE.thighL, BONE.shinL, BONE.footL, uL], [BONE.thighR, BONE.shinR, BONE.footR, uL + 0.5]] as const) {
    const hip = mix(HIP_WALK, HIP_RUN, u);
    const knee = clamp(mix(KNEE_WALK, KNEE_RUN, u), 0, 2.2);
    a[thigh * 3] = hip;
    // La jambe reste d'aplomb malgré la bascule et le déport du bassin : le pied d'appui ne glisse pas de côté.
    a[thigh * 3 + 2] = -roll - shift / legLen;
    a[shin * 3] = -knee;
    a[foot * 3] = clamp(mix(FOOT_WALK, FOOT_RUN, u) - hip + knee, -0.9, 0.9);
  }
  const ankle = Math.min(ankleBelowPelvis(a, BONE.thighL, BONE.shinL, -1, d), ankleBelowPelvis(a, BONE.thighR, BONE.shinR, 1, d));
  pose.rootDy = -ankle - legLen;

  // Bras : en opposition aux jambes, avec un léger retard ; coude plié, davantage quand le bras passe devant ; en courant, coudes à angle droit.
  const armSwing = 0.4 * w + 0.45 * r;
  for (const [arm, fore, side, s] of [[BONE.armL, BONE.forearmL, -1, Math.sin(phase - 0.2)], [BONE.armR, BONE.forearmR, 1, -Math.sin(phase - 0.2)]] as const) {
    const swing = -armSwing * s + 0.04 + 0.12 * r;
    a[arm * 3] = swing;
    a[arm * 3 + 2] = side * (0.1 + 0.06 * r);
    a[fore * 3] = 0.15 + 0.12 * w + 1.15 * r + (0.3 * w + 0.2 * r) * Math.max(0, swing);
  }

  // Buste penché (plus en courant, voûté chez les seniors), torsion inverse du bassin, bascule compensée ; la tête regarde droit devant.
  const stoop = d.stoop + 0.04 * w + 0.14 * r;
  a[BONE.torso * 3] = -stoop;
  a[BONE.torso * 3 + 1] = (0.11 + 0.05 * r) * w * Math.sin(phase);
  a[BONE.torso * 3 + 2] = -0.8 * roll;
  a[BONE.head * 3] = 0.7 * stoop;
  a[BONE.head * 3 + 1] = -0.8 * (a[BONE.pelvis * 3 + 1]! + a[BONE.torso * 3 + 1]!);
  a[BONE.head * 3 + 2] = -0.2 * roll;
}

/** Torsion maximale du bassin (rad) vers la direction de la marche en pas de côté (T4, D208). */
export const STRAFE_TWIST = 1.0;

/** Marche-t-on à reculons (direction de la marche à plus de ≈ 100° du regard) ? Le cycle de marche se joue alors à l'envers. */
export const walksBackward = (rel: number): boolean => Math.cos(rel) < -0.2;

/**
 * Pas de côté et à reculons (T4, D208), par-dessus `walkPose` : `rel` est la direction de la marche par rapport au regard (rad, positif vers la
 * droite), `w` (0 à 1) la part de l'effet (0 à l'arrêt). Le bassin et les jambes se tournent vers la marche (ou, à reculons, vers l'opposé de la
 * marche), d'au plus `STRAFE_TWIST` ; le buste tourne d'autant dans l'autre sens : le haut du corps et l'arme restent face au regard.
 */
export function strafePose(pose: Pose, rel: number, w: number): void {
  const a = pose.angles;
  const dir = walksBackward(rel) ? rel - Math.PI * Math.sign(rel || 1) : rel;
  const twist = clamp(dir, -STRAFE_TWIST, STRAFE_TWIST) * clamp(w, 0, 1);
  // Lacet positif : le personnage tourne vers sa gauche (son avant est −z, sa droite +x).
  a[BONE.pelvis * 3 + 1] = a[BONE.pelvis * 3 + 1]! - twist;
  a[BONE.torso * 3 + 1] = a[BONE.torso * 3 + 1]! + twist;
}

/**
 * En l'air (saut, chute), par-dessus une pose debout : jambes repliées et bras écartés vers le haut ; en tombant vite, les jambes se déplient
 * pour la réception. `vz` : vitesse verticale (m/s). Le bassin garde sa hauteur debout : les pieds remontent sous le corps.
 */
export function airPose(pose: Pose, vz: number): void {
  const a = pose.angles;
  const tuck = clamp(1 + vz / 9, 0.35, 1);
  for (const [thigh, shin, foot, lead] of [[BONE.thighL, BONE.shinL, BONE.footL, 1.15], [BONE.thighR, BONE.shinR, BONE.footR, 0.75]] as const) {
    a[thigh * 3] = lead * tuck;
    a[thigh * 3 + 2] = 0;
    a[shin * 3] = -1.5 * tuck;
    a[foot * 3] = 0.3 * tuck;
  }
  for (const [arm, fore, side] of [[BONE.armL, BONE.forearmL, -1], [BONE.armR, BONE.forearmR, 1]] as const) {
    a[arm * 3] = 0.9 + 0.5 * (1 - tuck);
    a[arm * 3 + 2] = side * 0.55;
    a[fore * 3] = 0.5;
  }
  a[BONE.torso * 3] = -0.12 * tuck;
  pose.rootDx = 0;
}

/** Escalade : bras tendus vers le haut, mains et pieds qui alternent ; `climbed` (m), hauteur gravie, donne le rythme. */
export function climbPose(pose: Pose, climbed: number): void {
  const a = pose.angles;
  a.fill(0);
  const s = Math.sin(climbed * 7);
  a[BONE.armL * 3] = 2.7 + 0.3 * s;
  a[BONE.armR * 3] = 2.7 - 0.3 * s;
  a[BONE.armL * 3 + 2] = -0.25;
  a[BONE.armR * 3 + 2] = 0.25;
  a[BONE.forearmL * 3] = 0.35 - 0.3 * s;
  a[BONE.forearmR * 3] = 0.35 + 0.3 * s;
  a[BONE.thighL * 3] = 0.8 - 0.5 * s;
  a[BONE.thighR * 3] = 0.8 + 0.5 * s;
  a[BONE.shinL * 3] = -1.3 + 0.4 * s;
  a[BONE.shinR * 3] = -1.3 - 0.4 * s;
  a[BONE.torso * 3] = -0.1;
  a[BONE.head * 3] = -0.25;
  pose.rootDx = 0;
}

/** Genre de pose d'un passant heurté : 1 il trébuche, 2 il tombe, reste au sol, puis se relève. */
export const HIT_POSE = { stumble: 1, down: 2 } as const;
/** Poses d'un personnage armé d'un pistolet (J5-5) : visée (la secousse du dernier tir suit `poseT`) et pistolet bas pendant la course. */
export const GUN_POSE = { aim: 3, ready: 4 } as const;
/** Poses de la vie de quartier (D198) : assis (banc, terrasse), téléphone à l'oreille (en marchant ou à l'arrêt), discussion (gestes des mains). */
export const LIFE_POSE = { sit: 5, phone: 6, talk: 7 } as const;
export const STUMBLE_TIME = 0.9;
/** Durée totale d'une chute : 0,85 s pour tomber et s'immobiliser, environ 1,2 s au sol, 1,5 s pour se relever (D210). */
export const DOWN_TIME = 3.6;
const FALL_TIME = 0.85, GETUP_TIME = 1.5, GETUP_AT = DOWN_TIME - GETUP_TIME;
/** Instant d'une chute où le corps est à terre, immobile : la pose que garde un mort (D209). */
export const LYING_T = FALL_TIME + 0.4;
/** Fondu (s) entre la pose d'avant le choc (marche, course, deux-roues) et la pose de choc (D209) : plus de saut d'une image à l'autre. */
export const HIT_BLEND = 0.16;

const smooth = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Copie une pose. */
export function copyPose(out: Pose, src: Pose): void {
  out.angles.set(src.angles);
  out.rootDy = src.rootDy;
  out.rootDx = src.rootDx;
}

/** Mélange deux poses (D209) : `w` = 0 donne `a`, 1 donne `b`. `out` peut être `a` ou `b`. Angle par angle : valable entre poses voisines. */
export function blendPose(out: Pose, a: Pose, b: Pose, w: number): void {
  const oa = out.angles, aa = a.angles, ba = b.angles;
  for (let k = 0; k < oa.length; k++) oa[k] = aa[k]! + (ba[k]! - aa[k]!) * w;
  out.rootDy = a.rootDy + (b.rootDy - a.rootDy) * w;
  out.rootDx = a.rootDx + (b.rootDx - a.rootDx) * w;
}

/** Debout, immobile : la pose de marche à vitesse nulle (celle d'où part et où revient toute pose de choc). */
export function standPose(pose: Pose, d: BodyDims): void {
  walkPose(pose, 0, 0, d);
}

// --- Contact avec le sol (D209) ---------------------------------------------------------------------------------------

const ONES = new Float32Array(BONE_COUNT * 3).fill(1);
const ORIGIN: Root = { x: 0, y: 0, z: 0, yaw: 0 };
const fkOffsets = new Float32Array(BONE_COUNT * 3), fkWorld = new Float32Array(BONE_COUNT * 16), fkRender = new Float32Array(BONE_COUNT * 16);

/**
 * Contact avec le sol : point le plus bas d'un tronçon de l'os (de y0 à y1 le long de l'os, dans son repère), de section elliptique
 * (demi-largeur `a` en x, demi-profondeur `c` en z, centrée en `z`), ou d'un ellipsoïde (demi-axes `a`, `b`, `c`) centré en (0, y, z).
 */
function lowestOfSegment(o: number, y0: number, y1: number, a: number, c: number, z = 0): number {
  const w = fkWorld;
  const py = w[o + 13]! + w[o + 9]! * z;
  const yA = py + w[o + 5]! * y0, yB = py + w[o + 5]! * y1;
  return Math.min(yA, yB) - Math.hypot(a * w[o + 1]!, c * w[o + 9]!);
}
function lowestOfEllipsoid(o: number, y: number, a: number, b: number, c: number, z = 0): number {
  const w = fkWorld;
  return w[o + 13]! + w[o + 5]! * y + w[o + 9]! * z - Math.hypot(a * w[o + 1]!, b * w[o + 5]!, c * w[o + 9]!);
}

/**
 * Hauteur (m) du point le plus bas du corps au-dessus du sol du personnage, pour cette pose (déport `rootDy` compris). Debout, elle vaut 0
 * (les semelles touchent le sol) ; au sol, c'est elle qui fait reposer le dos, le ventre, les bras et les jambes sur le pavé au lieu de flotter.
 * Les volumes reprennent, à un ou deux centimètres près, ceux de la géométrie du kit (`character-parts.ts`), mis à l'échelle comme elle.
 */
export function lowestPoint(pose: Pose, d: BodyDims): number {
  solveFk(pose, d);
  return lowestFk(d, true);
}

/** Matrices des os (sans échelle, personnage à l'origine) dans `fkWorld`. */
function solveFk(pose: Pose, d: BodyDims): void {
  restOffsets(d, fkOffsets);
  solveBones(fkRender, fkWorld, fkOffsets, ONES, pose, ORIGIN);
}

/** Point le plus bas d'après `fkWorld` ; sans les bras si `arms` est faux (le corps qui repose, avant que les mains se posent). */
function lowestFk(d: BodyDims, arms: boolean): number {
  const R = REF_DIMS, s = d.height / R.height, depth = d.torsoDepth / R.torsoDepth;
  const chest = (d.shoulderHalf + d.waistHalf) / (R.shoulderHalf + R.waistHalf), limb = d.limbRadius / R.limbRadius, head = d.headRadius / R.headRadius;
  let low = Infinity;
  const take = (v: number): void => {
    if (v < low) low = v;
  };
  take(lowestOfSegment(BONE.pelvis * 16, -0.13 * s, 0.03 * s, 0.165 * (d.hipHalf / R.hipHalf), 0.1 * depth, 0.01 * depth));
  take(lowestOfSegment(BONE.torso * 16, 0, 0.47 * (d.torso / R.torso), 0.17 * chest, 0.11 * depth));
  take(lowestOfEllipsoid(BONE.head * 16, d.headCenterY - (d.neckY - 0.015 * d.height), 0.08 * head, 0.11 * head, 0.095 * head));
  for (const [arm, fore] of [[BONE.armL, BONE.forearmL], [BONE.armR, BONE.forearmR]] as const) {
    if (!arms) break;
    take(lowestOfSegment(arm * 16, -d.upperArm, 0, 0.045 * limb, 0.045 * limb));
    take(lowestOfSegment(fore * 16, -d.forearm - 0.5 * d.hand, 0, 0.035 * limb, 0.035 * limb));
  }
  for (const [thigh, shin, foot] of [[BONE.thighL, BONE.shinL, BONE.footL], [BONE.thighR, BONE.shinR, BONE.footR]] as const) {
    take(lowestOfSegment(thigh * 16, -d.thigh, -0.06 * s, 0.07 * limb, 0.07 * limb));
    take(lowestOfSegment(shin * 16, -d.shin, 0, 0.048 * limb, 0.048 * limb));
    // Talon et pointe : debout, ils touchent le sol (la cheville est à `ankleY`).
    take(lowestOfEllipsoid(foot * 16, 0.03 - d.ankleY, 0.03, 0.03, 0.03, 0.025 * d.height));
    take(lowestOfEllipsoid(foot * 16, 0.025 - d.ankleY, 0.025, 0.025, 0.025, -0.11 * d.height));
  }
  return low;
}

/**
 * Mains posées (D210) : un bras dont la main passerait sous le sol plie le coude pour la poser au sol, au lieu de soulever tout le corps
 * (entre deux clés, un bras qui tourne passe par des angles où il est « trop long »). Cinématique inverse à deux os dans le plan du corps
 * (avant-arrière, vertical) : la main garde sa position avant-arrière et descend au sol ; l'épaule ne bouge pas. Un bras très écarté (qui
 * glisse à plat sur le sol) se déplie plutôt, juste assez. `fkWorld` doit être celui de la pose, `pose.rootDy` le déport qui fait reposer le corps.
 */
/** Au plus, ce dont les bras peuvent soulever le corps qui repose au sol (m). */
const ARM_LIFT = 0.03;

function plantHands(pose: Pose, d: BodyDims): boolean {
  const a = pose.angles, w = fkWorld, dy = pose.rootDy;
  const r = 0.035 * (d.limbRadius / REF_DIMS.limbRadius);
  const reach = d.forearm + 0.5 * d.hand;
  let moved = false;
  for (const [arm, fore] of [[BONE.armL, BONE.forearmL], [BONE.armR, BONE.forearmR]] as const) {
    const rz = a[arm * 3 + 2]!;
    const o = fore * 16;
    const handY = (): number => w[o + 13]! - w[o + 5]! * reach + dy;
    const hy = handY(), hz = w[o + 14]! - w[o + 6]! * reach;
    if (hy >= r) continue;
    if (Math.abs(rz) > 0.8) {
      // Bras écarté qui glisse à plat sur le sol : on déplie l'épaule et le coude (vers le bras posé à plat) juste assez pour que la main
      // reste au-dessus du sol (recherche par dichotomie).
      const ax = a[arm * 3]!, fx = a[fore * 3]!;
      let lo = 0, hi = 1;
      for (let it = 0; it < 6; it++) {
        const mid = 0.5 * (lo + hi);
        a[arm * 3] = ax * mid;
        a[fore * 3] = fx * mid;
        solveFk(pose, d);
        if (handY() >= r) lo = mid;
        else hi = mid;
      }
      a[arm * 3] = ax * lo;
      a[fore * 3] = fx * lo;
      solveFk(pose, d);
      moved = true;
      continue;
    }
    // Longueurs vues dans le plan du corps (le bras écarté de `rz` en sort un peu).
    const c = Math.cos(rz), l1 = d.upperArm * c, l2 = reach * c;
    const ey = r - (w[arm * 16 + 13]! + dy), ez = hz - w[arm * 16 + 14]!;
    const dist = clamp(Math.hypot(ey, ez), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
    // Angle d'un membre dans ce plan : 0 pendant, positif vers l'avant (−z) ; somme des `rx` de ses parents.
    const toward = Math.atan2(-ez, -ey);
    const bend = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
    const back = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
    a[arm * 3] = toward - back - a[BONE.pelvis * 3]! - a[BONE.torso * 3]!;
    a[fore * 3] = bend;
    moved = true;
  }
  return moved;
}

// --- Poses au sol (D209) ---------------------------------------------------------------------------------------------

/** Os, puis angles (rx, ry, rz) : une pose écrite par ses seuls os qui bougent, les autres à zéro. */
type Spec = readonly (readonly [number, number, number, number])[];

/**
 * Corps à terre. Sur le dos : bassin basculé de 90° en arrière, la face vers le ciel (un membre tourné en `rx` positif monte vers le ciel) ;
 * à plat ventre : de 90° en avant (un `rx` positif enfonce le membre vers le sol). Dans les deux cas, `rz` d'un membre (et de son enfant) le fait
 * glisser à plat sur le sol : c'est ainsi que se plient coudes et genoux posés au sol. `ry` du buste le roule un peu sur le côté, `ry` de la tête
 * la tourne (joue au sol), `ry` d'un pied le tourne vers l'extérieur. (`ry` d'une cuisse ou d'un bras, lui, tourne autour de l'axe du parent :
 * il soulèverait le membre, on ne s'en sert pas.)
 */
const LYING_BACK: readonly Spec[] = [
  // Bras en croix, un genou levé, la tête tournée.
  [
    [BONE.pelvis, Math.PI / 2, 0, 0], [BONE.torso, 0, 0.06, 0], [BONE.head, -0.05, 0.85, 0],
    [BONE.armL, 0, 0, -1.35], [BONE.forearmL, 0, 0, -0.5], [BONE.armR, 0, 0, 0.95], [BONE.forearmR, 0, 0, 0.6],
    [BONE.thighL, 0.65, 0, -0.1], [BONE.shinL, -1.2, 0, 0], [BONE.footL, 0.2, 0, 0],
    [BONE.thighR, 0, 0, 0.2], [BONE.shinR, -0.08, 0, 0], [BONE.footR, -0.7, -0.5, 0],
  ],
  // Bras le long du corps, une jambe tendue, l'autre pliée et tombée à plat sur le côté.
  [
    [BONE.pelvis, Math.PI / 2, 0, 0], [BONE.torso, 0, -0.05, 0], [BONE.head, -0.05, -0.6, 0],
    [BONE.armL, 0, 0, -0.3], [BONE.forearmL, 0, 0, -0.15], [BONE.armR, 0, 0, 0.4], [BONE.forearmR, 0, 0, -0.35],
    [BONE.thighL, 0.05, 0, -0.75], [BONE.shinL, 0, 0, 1.4], [BONE.footL, -0.6, 0.4, 0],
    [BONE.thighR, 0, 0, 0.1], [BONE.shinR, -0.06, 0, 0], [BONE.footR, -0.75, -0.6, 0],
  ],
  // Un bras au-dessus de la tête, les deux jambes pliées et tombées du même côté.
  [
    [BONE.pelvis, Math.PI / 2, 0, 0], [BONE.torso, 0, 0.08, 0], [BONE.head, -0.1, 0.45, 0],
    [BONE.armL, 0, 0, -2.6], [BONE.forearmL, 0, 0, -0.45], [BONE.armR, 0, 0, 0.6], [BONE.forearmR, 0, 0, 0.3],
    [BONE.thighL, 0.05, 0, 0.35], [BONE.shinL, 0, 0, -1.1], [BONE.footL, -0.6, 0, 0],
    [BONE.thighR, 0.05, 0, 0.55], [BONE.shinR, 0, 0, -1.2], [BONE.footR, -0.6, 0, 0],
  ],
];
const LYING_FRONT: readonly Spec[] = [
  // Un bras replié près de la tête, l'autre le long du corps, une jambe repliée sur le côté, la joue au sol.
  [
    [BONE.pelvis, -Math.PI / 2, 0, 0], [BONE.torso, 0, -0.06, 0], [BONE.head, 0.1, 1.3, 0],
    [BONE.armL, 0, 0, -2.0], [BONE.forearmL, 0, 0, 1.5], [BONE.armR, 0, 0, 0.3], [BONE.forearmR, 0, 0, 0.1],
    [BONE.thighL, 0, 0, -0.8], [BONE.shinL, 0, 0, 1.3], [BONE.footL, -0.7, 0.8, 0],
    [BONE.thighR, 0, 0, 0.1], [BONE.shinR, -0.05, 0, 0], [BONE.footR, -0.7, -0.8, 0],
  ],
  // Bras le long du corps, jambes tendues, la tête tournée.
  [
    [BONE.pelvis, -Math.PI / 2, 0, 0], [BONE.torso, 0, 0.1, 0], [BONE.head, 0.1, -1.25, 0],
    [BONE.armL, 0, 0, -0.3], [BONE.forearmL, 0, 0, -0.1], [BONE.armR, 0, 0, 0.25], [BONE.forearmR, 0, 0, 0.1],
    [BONE.thighL, 0, 0, -0.15], [BONE.shinL, -0.1, 0, 0], [BONE.footL, -0.7, 0.9, 0],
    [BONE.thighR, 0, 0, 0.2], [BONE.shinR, -0.15, 0, 0], [BONE.footR, -0.75, -0.7, 0],
  ],
  // Les deux bras en avant, comme pour amortir la chute, jambes écartées.
  [
    [BONE.pelvis, -Math.PI / 2, 0, 0], [BONE.torso, 0, 0.05, 0], [BONE.head, 0.1, 1.1, 0],
    [BONE.armL, 0, 0, -2.6], [BONE.forearmL, 0, 0, 0.5], [BONE.armR, 0, 0, 2.3], [BONE.forearmR, 0, 0, -0.6],
    [BONE.thighL, 0, 0, -0.3], [BONE.shinL, -0.2, 0, 0], [BONE.footL, -0.7, 0.8, 0],
    [BONE.thighR, 0, 0, 0.25], [BONE.shinR, -0.15, 0, 0], [BONE.footR, -0.7, -0.9, 0],
  ],
];
/** Nombre de poses au sol par côté de chute, symétriques comprises (chacune existe aussi en miroir gauche-droite). */
export const LYING_VARIANTS = 2 * LYING_BACK.length;

/** Os du côté opposé (gauche ↔ droite). */
const MIRROR: readonly number[] = [0, 1, 2, 5, 6, 3, 4, 9, 10, 7, 8, 12, 11];

/**
 * Pose au sol (D209) : `side` +1 sur le dos, −1 à plat ventre ; `variant` choisit l'une des `LYING_VARIANTS` poses (les impaires sont les
 * symétriques des paires : ce qui était à gauche passe à droite, les rotations autour de y et de z changent de signe). Sans contact avec le sol :
 * `rootDy` est fixé par `hitPose`.
 */
export function lyingPose(pose: Pose, side: number, variant: number): void {
  const a = pose.angles;
  a.fill(0);
  pose.rootDx = 0;
  pose.rootDy = 0;
  const list = side > 0 ? LYING_BACK : LYING_FRONT;
  const v = ((Math.floor(variant) % LYING_VARIANTS) + LYING_VARIANTS) % LYING_VARIANTS;
  const spec = list[v >> 1]!;
  const mirror = (v & 1) === 1;
  for (const [bone, rx, ry, rz] of spec) {
    const b = mirror ? MIRROR[bone]! : bone;
    a[b * 3] = rx;
    a[b * 3 + 1] = mirror ? -ry : ry;
    a[b * 3 + 2] = mirror ? -rz : rz;
  }
}

/** Variante de pose au sol propre à un emplacement (les passants ne tombent pas tous de la même façon). */
export const lyingVariant = (slot: number): number => (Math.imul(slot + 1, 0x9e3779b1) >>> 7) % LYING_VARIANTS;

// --- Chute en plusieurs temps et relevé (D210) ------------------------------------------------------------------------

/**
 * Une clé de la chute : instant (s), pose, et `hold` (la pose est tenue : tangente nulle, on y arrive et on en repart sans dépasser).
 * Poses : `stand` (debout immobile), `lie` (la pose au sol de la variante), `lie` + `delta` (la pose au sol, retouchée : le rebond), ou une
 * pose écrite (`spec`, os non cités à zéro).
 */
interface Key {
  t: number;
  kind: "stand" | "lie" | "spec";
  spec?: Spec;
  delta?: Spec;
  hold?: boolean;
}

/**
 * Chute sur le dos (choc de face). Le choc rejette le buste en arrière, la tête suit en retard (coup du lapin), les bras partent en avant ;
 * les genoux lâchent, le corps descend en arrière et se rattrape sur les mains ; il touche le sol par les fesses, puis le dos ; les jambes et la
 * tête rebondissent, puis tout se pose. Relevé : il s'assoit, ramène les pieds sous lui en s'appuyant d'une main, se redresse.
 */
const FALL_BACK: readonly Key[] = [
  { t: 0, kind: "stand", hold: true },
  {
    t: 0.12, kind: "spec", spec: [
      [BONE.pelvis, 0.12, 0, 0], [BONE.torso, 0.3, 0, 0], [BONE.head, -0.4, 0, 0],
      [BONE.armL, 0.9, 0, -0.45], [BONE.forearmL, 0.5, 0, 0], [BONE.armR, 0.8, 0, 0.5], [BONE.forearmR, 0.45, 0, 0],
      [BONE.thighL, 0.2, 0, -0.05], [BONE.shinL, -0.35, 0, 0], [BONE.thighR, 0.1, 0, 0.05], [BONE.shinR, -0.25, 0, 0],
    ],
  },
  {
    t: 0.3, kind: "spec", spec: [
      [BONE.pelvis, 0.55, 0, 0], [BONE.torso, 0.15, 0, 0], [BONE.head, -0.5, 0, 0],
      [BONE.armL, -0.6, 0, -0.45], [BONE.forearmL, 0.25, 0, 0], [BONE.armR, -0.5, 0, 0.5], [BONE.forearmR, 0.25, 0, 0],
      [BONE.thighL, 1.0, 0, -0.1], [BONE.shinL, -1.5, 0, 0], [BONE.footL, 0.3, 0, 0],
      [BONE.thighR, 0.85, 0, 0.1], [BONE.shinR, -1.3, 0, 0], [BONE.footR, 0.3, 0, 0],
    ],
  },
  {
    t: 0.46, kind: "spec", spec: [
      [BONE.pelvis, 1.05, 0, 0], [BONE.torso, 0.25, 0, 0], [BONE.head, -0.55, 0, 0],
      [BONE.armL, -0.3, 0, -0.75], [BONE.forearmL, 0.2, 0, 0], [BONE.armR, -0.25, 0, 0.8], [BONE.forearmR, 0.2, 0, 0],
      [BONE.thighL, 0.75, 0, -0.1], [BONE.shinL, -0.9, 0, 0], [BONE.footL, 0.2, 0, 0],
      [BONE.thighR, 0.6, 0, 0.1], [BONE.shinR, -0.7, 0, 0], [BONE.footR, 0.2, 0, 0],
    ],
  },
  // Le dos touche : les jambes et la tête rebondissent.
  { t: 0.62, kind: "lie", delta: [[BONE.head, -0.35, 0, 0], [BONE.thighL, 0.35, 0, 0], [BONE.thighR, 0.3, 0, 0], [BONE.torso, 0.08, 0, 0]] },
  { t: FALL_TIME, kind: "lie", hold: true },
  { t: GETUP_AT, kind: "lie", hold: true },
  // Assis, en appui sur les mains derrière soi.
  {
    t: GETUP_AT + 0.4, kind: "spec", spec: [
      [BONE.pelvis, 0.45, 0, 0], [BONE.torso, -0.25, 0, 0], [BONE.head, -0.1, 0, 0],
      [BONE.armL, -0.55, 0, -0.3], [BONE.forearmL, 0.1, 0, 0], [BONE.armR, -0.55, 0, 0.3], [BONE.forearmR, 0.1, 0, 0],
      [BONE.thighL, 1.75, 0, -0.08], [BONE.shinL, -1.3, 0, 0], [BONE.footL, 0.4, 0, 0],
      [BONE.thighR, 1.15, 0, 0.08], [BONE.shinR, -0.1, 0, 0], [BONE.footR, -0.3, 0, 0],
    ],
  },
  // Accroupi, les pieds ramenés sous le corps, une main au sol, l'autre sur le genou.
  {
    t: GETUP_AT + 0.85, kind: "spec", spec: [
      [BONE.pelvis, -0.35, 0, 0], [BONE.torso, -0.35, 0, 0], [BONE.head, 0.45, 0, 0],
      [BONE.armL, 0.9, 0, -0.2], [BONE.forearmL, 0.2, 0, 0], [BONE.armR, 0.7, 0, 0.15], [BONE.forearmR, 0.9, 0, 0],
      [BONE.thighL, 1.9, 0, -0.12], [BONE.shinL, -2.0, 0, 0], [BONE.footL, 0.45, 0, 0],
      [BONE.thighR, 1.75, 0, 0.12], [BONE.shinR, -1.95, 0, 0], [BONE.footR, 0.55, 0, 0],
    ],
  },
  // À demi relevé.
  {
    t: GETUP_AT + 1.15, kind: "spec", spec: [
      [BONE.pelvis, -0.25, 0, 0], [BONE.torso, -0.15, 0, 0], [BONE.head, 0.25, 0, 0],
      [BONE.armL, 0.35, 0, -0.15], [BONE.forearmL, 0.3, 0, 0], [BONE.armR, 0.3, 0, 0.15], [BONE.forearmR, 0.6, 0, 0],
      [BONE.thighL, 0.95, 0, -0.05], [BONE.shinL, -1.0, 0, 0], [BONE.footL, 0.3, 0, 0],
      [BONE.thighR, 0.85, 0, 0.05], [BONE.shinR, -0.95, 0, 0], [BONE.footR, 0.35, 0, 0],
    ],
  },
  { t: DOWN_TIME, kind: "stand", hold: true },
];

/**
 * Chute à plat ventre (choc par derrière). Le bassin part en avant, le buste et la tête restent en arrière, les bras sont rejetés ; un pas pour
 * se rattraper, puis les genoux lâchent, les bras partent en avant pour amortir ; à genoux sur les mains, puis la poitrine touche (la tête se
 * relève au choc) et tout se pose. Relevé : pompe sur les bras, à quatre pattes, un genou en avant, debout.
 */
const FALL_FRONT: readonly Key[] = [
  { t: 0, kind: "stand", hold: true },
  {
    t: 0.12, kind: "spec", spec: [
      [BONE.pelvis, -0.1, 0, 0], [BONE.torso, 0.2, 0, 0], [BONE.head, 0.35, 0, 0],
      [BONE.armL, -0.45, 0, -0.35], [BONE.forearmL, 0.3, 0, 0], [BONE.armR, -0.4, 0, 0.35], [BONE.forearmR, 0.3, 0, 0],
      [BONE.thighL, 0.55, 0, -0.05], [BONE.shinL, -0.5, 0, 0], [BONE.thighR, -0.1, 0, 0.05], [BONE.shinR, -0.15, 0, 0],
    ],
  },
  {
    t: 0.3, kind: "spec", spec: [
      [BONE.pelvis, -0.55, 0, 0], [BONE.torso, -0.2, 0, 0], [BONE.head, 0.5, 0, 0],
      [BONE.armL, 1.35, 0, -0.3], [BONE.forearmL, 0.35, 0, 0], [BONE.armR, 1.3, 0, 0.3], [BONE.forearmR, 0.35, 0, 0],
      [BONE.thighL, 0.75, 0, -0.08], [BONE.shinL, -0.9, 0, 0], [BONE.footL, -0.2, 0, 0],
      [BONE.thighR, 0.5, 0, 0.08], [BONE.shinR, -0.8, 0, 0], [BONE.footR, -0.2, 0, 0],
    ],
  },
  {
    t: 0.45, kind: "spec", spec: [
      [BONE.pelvis, -1.0, 0, 0], [BONE.torso, -0.3, 0, 0], [BONE.head, 0.7, 0, 0],
      [BONE.armL, 1.5, 0, -0.35], [BONE.forearmL, 0.45, 0, 0], [BONE.armR, 1.45, 0, 0.35], [BONE.forearmR, 0.45, 0, 0],
      [BONE.thighL, 0.55, 0, -0.1], [BONE.shinL, -1.2, 0, 0], [BONE.footL, -0.5, 0, 0],
      [BONE.thighR, 0.45, 0, 0.1], [BONE.shinR, -1.1, 0, 0], [BONE.footR, -0.5, 0, 0],
    ],
  },
  // Les coudes plient (ils montent au-dessus des épaules, avant-bras droits), la poitrine descend vers le sol, les genoux glissent en arrière.
  {
    t: 0.53, kind: "spec", spec: [
      [BONE.pelvis, -1.3, 0, 0], [BONE.torso, -0.1, 0, 0], [BONE.head, 0.65, 0, 0],
      [BONE.armL, -0.4, 0, -0.35], [BONE.forearmL, 2.0, 0, 0], [BONE.armR, -0.4, 0, 0.35], [BONE.forearmR, 2.0, 0, 0],
      [BONE.thighL, 0.25, 0, -0.1], [BONE.shinL, -0.55, 0, 0], [BONE.footL, -0.8, 0, 0],
      [BONE.thighR, 0.2, 0, 0.1], [BONE.shinR, -0.5, 0, 0], [BONE.footR, -0.8, 0, 0],
    ],
  },
  // La poitrine touche : la tête se relève, les jambes rebondissent.
  { t: 0.62, kind: "lie", delta: [[BONE.head, -0.35, 0, 0], [BONE.shinL, -0.25, 0, 0], [BONE.shinR, -0.15, 0, 0], [BONE.torso, 0.1, 0, 0]] },
  { t: FALL_TIME, kind: "lie", hold: true },
  { t: GETUP_AT, kind: "lie", hold: true },
  // Les mains se posent sous les épaules, coudes levés ; la tête se relève.
  {
    t: GETUP_AT + 0.2, kind: "spec", spec: [
      [BONE.pelvis, -Math.PI / 2, 0, 0], [BONE.head, 0.4, 0, 0],
      [BONE.armL, -0.4, 0, -0.35], [BONE.forearmL, 2.0, 0, 0], [BONE.armR, -0.4, 0, 0.35], [BONE.forearmR, 2.0, 0, 0],
      [BONE.thighL, 0, 0, -0.1], [BONE.shinL, -0.1, 0, 0], [BONE.footL, -0.8, 0, 0],
      [BONE.thighR, 0, 0, 0.1], [BONE.shinR, -0.1, 0, 0], [BONE.footR, -0.8, 0, 0],
    ],
  },
  // Pompe : le buste se soulève, le bassin reste au sol.
  {
    t: GETUP_AT + 0.45, kind: "spec", spec: [
      [BONE.pelvis, -1.45, 0, 0], [BONE.torso, 0.55, 0, 0], [BONE.head, 0.35, 0, 0],
      [BONE.armL, 1.1, 0, -0.25], [BONE.forearmL, 0.9, 0, 0], [BONE.armR, 1.1, 0, 0.25], [BONE.forearmR, 0.9, 0, 0],
      [BONE.thighL, -0.12, 0, -0.1], [BONE.shinL, -0.3, 0, 0], [BONE.footL, -0.7, 0, 0],
      [BONE.thighR, -0.12, 0, 0.1], [BONE.shinR, -0.25, 0, 0], [BONE.footR, -0.7, 0, 0],
    ],
  },
  // À quatre pattes : genoux sous le bassin, mains sous les épaules.
  {
    t: GETUP_AT + 0.8, kind: "spec", spec: [
      [BONE.pelvis, -1.15, 0, 0], [BONE.torso, 0.05, 0, 0], [BONE.head, 0.6, 0, 0],
      [BONE.armL, 1.1, 0, -0.15], [BONE.forearmL, 0.1, 0, 0], [BONE.armR, 1.1, 0, 0.15], [BONE.forearmR, 0.1, 0, 0],
      [BONE.thighL, 1.15, 0, -0.08], [BONE.shinL, -1.6, 0, 0], [BONE.footL, -1.1, 0, 0],
      [BONE.thighR, 1.1, 0, 0.08], [BONE.shinR, -1.55, 0, 0], [BONE.footR, -1.1, 0, 0],
    ],
  },
  // Le pied gauche avance sous le corps, genou plié ; les mains restent au sol.
  {
    t: GETUP_AT + 0.95, kind: "spec", spec: [
      [BONE.pelvis, -0.75, 0, 0], [BONE.head, 0.55, 0, 0],
      [BONE.armL, 0.9, 0, -0.15], [BONE.forearmL, 0.1, 0, 0], [BONE.armR, 0.9, 0, 0.15], [BONE.forearmR, 0.1, 0, 0],
      [BONE.thighL, 1.9, 0, -0.05], [BONE.shinL, -2.1, 0, 0], [BONE.footL, 0.95, 0, 0],
      [BONE.thighR, 0.8, 0, 0.08], [BONE.shinR, -1.6, 0, 0], [BONE.footR, -0.45, 0, 0],
    ],
  },
  // Un genou à terre (orteils repliés au sol, pied à 45°), l'autre pied posé devant, une main sur le genou.
  {
    t: GETUP_AT + 1.1, kind: "spec", spec: [
      [BONE.pelvis, -0.2, 0, 0], [BONE.torso, -0.2, 0, 0], [BONE.head, 0.3, 0, 0],
      [BONE.armL, 0.75, 0, -0.1], [BONE.forearmL, 0.5, 0, 0], [BONE.armR, 0.3, 0, 0.2], [BONE.forearmR, 0.3, 0, 0],
      [BONE.thighL, 1.65, 0, -0.05], [BONE.shinL, -1.5, 0, 0], [BONE.footL, 0.05, 0, 0],
      [BONE.thighR, 0.2, 0, 0.08], [BONE.shinR, -1.6, 0, 0], [BONE.footR, -0.45, 0, 0],
    ],
  },
  { t: DOWN_TIME, kind: "stand", hold: true },
];

/**
 * Retard de chaque os sur le temps de la chute (s, D210) : les jambes lâchent les premières (de peu : la chaîne bassin, cuisse, jambe reste d'un bloc quand elle porte le corps), le bassin suit, puis le buste, les bras, et la tête
 * en dernier (elle fouette). C'est ce décalage qui ôte l'impression d'un mannequin dont on tire tous les fils à la fois.
 */
const BONE_LAG: readonly number[] = [0, 0.025, 0.07, 0.045, 0.075, 0.045, 0.075, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01];

/** Espace de travail : une pose par clé (la plus longue suite en compte 14). */
const KEY_MAX = 16;
const keyPoses: Pose[] = Array.from({ length: KEY_MAX }, () => createPose());
/** Clés déjà calculées pour l'appel en cours (on ne calcule que celles qu'il faut : deux au sol, quatre au plus en mouvement). */
const keyReady = new Uint8Array(KEY_MAX);
let keyArgs: { keys: readonly Key[]; side: number; variant: number; d: BodyDims } | null = null;

function keyAt(k: number): Pose {
  if (!keyReady[k]) {
    const { keys, side, variant, d } = keyArgs!;
    keyPose(keyPoses[k]!, keys[k]!, side, variant, d);
    keyReady[k] = 1;
  }
  return keyPoses[k]!;
}

function keyPose(out: Pose, key: Key, side: number, variant: number, d: BodyDims): void {
  if (key.kind === "stand") {
    standPose(out, d);
    return;
  }
  const a = out.angles;
  if (key.kind === "lie") lyingPose(out, side, variant);
  else {
    a.fill(0);
    for (const [bone, rx, ry, rz] of key.spec!) {
      a[bone * 3] = rx;
      a[bone * 3 + 1] = ry;
      a[bone * 3 + 2] = rz;
    }
  }
  if (key.delta) {
    for (const [bone, rx, ry, rz] of key.delta) {
      a[bone * 3]! += rx;
      a[bone * 3 + 1]! += ry;
      a[bone * 3 + 2]! += rz;
    }
  }
  out.rootDx = 0;
  out.rootDy = 0;
}

/** Tension des tangentes (Catmull-Rom : 1) : à 1, les membres dépassent les poses de contact et le corps décolle du sol. */
const TENSION = 0.5;

/** Tangente (par unité de temps) d'une valeur à la clé k : nulle sur une clé tenue, sinon pente entre ses voisines (Catmull-Rom tendue). */
function slope(keys: readonly Key[], k: number, j: number): number {
  const key = keys[k]!;
  if (key.hold || k === 0 || k === keys.length - 1) return 0;
  return (TENSION * (keyAt(k + 1).angles[j]! - keyAt(k - 1).angles[j]!)) / (keys[k + 1]!.t - keys[k - 1]!.t);
}

/**
 * Pose de chute (D210) à l'instant `t` : chaque os lit la suite de clés à son propre instant (`BONE_LAG`), par une courbe lisse qui passe par
 * les clés (Hermite) ; les clés tenues sont atteintes sans dépassement, les autres sont traversées avec leur élan.
 */
export function fallPose(pose: Pose, t: number, side: number, variant: number, d: BodyDims): void {
  const keys = side > 0 ? FALL_BACK : FALL_FRONT;
  keyReady.fill(0);
  keyArgs = { keys, side, variant, d };
  const a = pose.angles;
  // Les retards s'effacent au tout début et à la toute fin : debout à l'instant du choc et à la fin du relevé, à l'identique. Moitié moins au relevé.
  const lag = Math.min(1, t / 0.05, (DOWN_TIME - t) / 0.05) * (t < GETUP_AT ? 1 : 0.5);
  for (let b = 0; b < BONE_COUNT; b++) {
    const tb = clamp(t - lag * BONE_LAG[b]!, 0, DOWN_TIME);
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1]!.t <= tb) k++;
    const k0 = keys[k]!, k1 = keys[k + 1]!;
    const h = k1.t - k0.t;
    const u = clamp((tb - k0.t) / h, 0, 1), u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let c = 0; c < 3; c++) {
      const j = b * 3 + c;
      a[j] = h00 * keyAt(k).angles[j]! + h10 * h * slope(keys, k, j) + h01 * keyAt(k + 1).angles[j]! + h11 * h * slope(keys, k + 1, j);
    }
  }
  // Au sol, il respire : le buste se soulève doucement (rien chez un mort, dont le temps est figé).
  if (t > FALL_TIME && t < GETUP_AT) {
    const w = Math.min(1, (t - FALL_TIME) / 0.3, (GETUP_AT - t) / 0.2);
    a[BONE.torso * 3]! += side * 0.03 * w * Math.sin(((t - FALL_TIME) * 2 * Math.PI) / 2.6);
  }
  pose.rootDx = 0;
  pose.rootDy = 0;
}

/**
 * Pose d'un passant heurté, `t` secondes après le choc. `kind` : trébuchement (penché, bras en avant, retrouve l'équilibre) ou chute (tombe en
 * `FALL_TIME`, reste à terre, se relève). `side` : +1 il tombe sur le dos (choc de face), −1 vers l'avant (choc par derrière).
 * D209 : la pose part de `from` (la pose d'avant le choc : marche, course, deux-roues ; debout si absente) par un fondu de `HIT_BLEND` s, et
 * revient à la pose debout immobile, d'où la marche reprend sans saut. Au sol, l'une des `LYING_VARIANTS` poses (`variant`), le corps posé à plat :
 * le point le plus bas du corps touche le sol pendant toute la chute (le corps bascule sur les pieds, puis repose sur le dos ou le ventre).
 */
export function hitPose(pose: Pose, kind: number, t: number, side: number, d: BodyDims, from: Pose | null = null, variant = 0): void {
  const a = pose.angles;
  if (kind === HIT_POSE.stumble) {
    standPose(pose, d);
    const env = Math.sin(Math.PI * clamp(t / STUMBLE_TIME, 0, 1));
    a[BONE.pelvis * 3]! += side * 0.5 * env;
    a[BONE.torso * 3]! += side * 0.25 * env;
    a[BONE.head * 3]! += -side * 0.2 * env;
    a[BONE.armL * 3]! += 1.1 * env;
    a[BONE.armR * 3]! += 1.1 * env;
    a[BONE.armL * 3 + 2]! += -0.7 * env;
    a[BONE.armR * 3 + 2]! += 0.7 * env;
    a[BONE.forearmL * 3]! += 0.5 * env;
    a[BONE.forearmR * 3]! += 0.5 * env;
    a[BONE.thighL * 3]! += 0.45 * env;
    a[BONE.shinL * 3]! += -0.6 * env;
    a[BONE.thighR * 3]! += -0.2 * env;
    pose.rootDy += -0.05 * env;
    if (from && t < HIT_BLEND) blendPose(pose, from, pose, smooth(t / HIT_BLEND));
    return;
  }
  fallPose(pose, t, side, variant, d);
  if (from && t < HIT_BLEND) blendPose(pose, from, pose, smooth(t / HIT_BLEND));
  // Le corps repose sur son point le plus bas : les pieds au début de la chute, le dos ou le ventre une fois à terre. Les bras ne le soulèvent
  // pas : une main qui passerait sous le sol s'y pose en pliant le coude (D210).
  pose.rootDx = 0;
  pose.rootDy = 0;
  solveFk(pose, d);
  const body = -lowestFk(d, false);
  pose.rootDy = body;
  if (plantHands(pose, d)) {
    solveFk(pose, d);
    pose.rootDy -= lowestFk(d, true);
  } else pose.rootDy = -lowestFk(d, true);
  // Un bras que la cinématique inverse n'a pas posé (couché sur le côté, hors d'atteinte) ne soulève pas le corps de plus de 3 cm : la main
  // s'enfonce un peu plutôt que tout le corps ne flotte.
  pose.rootDy = Math.min(pose.rootDy, body + ARM_LIFT);
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

const REF_OFFSETS = restOffsets(REF_DIMS);
const smoothstep = (a: number, b: number, v: number): number => smooth((v - a) / (b - a));
/** 1 jusqu'à l'articulation (d ≤ 0), puis s'éteint en douceur sur la longueur `l`. */
const fade = (d: number, l: number): number => 1 - smoothstep(0, l, d);

/**
 * Peau souple aux articulations (étape « personnages », D99) : un sommet proche d'une articulation suit en partie l'os voisin.
 * Le nuanceur le fait tourner autour de l'articulation d'une fraction (`w`) de l'écart d'orientation entre les deux os : à la jointure
 * (w = 0,5) les deux côtés se rejoignent à mi-chemin, comme un coude qui plie au lieu de deux tubes qui se croisent.
 * Entrée : os porteur et position du sommet dans son repère (corps de référence). Sortie dans `out` : autre os, poids (0 à 0,5) et
 * pivot (1 : l'articulation est l'origine de l'autre os, qui est l'enfant ; 0 : celle de l'os porteur). Poids nul : sommet rigide.
 */
export function jointBlend(bone: number, x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
  let other = 0, w = 0, pivot = 0;
  const take = (o: number, weight: number, p: number): void => {
    if (weight > w) [other, w, pivot] = [o, weight, p];
  };
  const R = REF_DIMS;
  switch (bone) {
    case BONE.armL:
    case BONE.armR:
      take(BONE.torso, 0.5 * fade(-y, 0.13), 0);
      take(bone + 1, 0.5 * fade(y + R.upperArm, 0.07), 1);
      break;
    case BONE.forearmL:
    case BONE.forearmR:
      take(bone - 1, 0.5 * fade(-y, 0.07), 0);
      break;
    case BONE.thighL:
    case BONE.thighR:
      take(BONE.pelvis, 0.5 * fade(-y, 0.12), 0);
      take(bone + 1, 0.5 * fade(y + R.thigh, 0.09), 1);
      break;
    case BONE.shinL:
    case BONE.shinR:
      take(bone - 1, 0.5 * fade(-y, 0.09), 0);
      break;
    case BONE.torso: {
      take(BONE.pelvis, 0.5 * fade(y, 0.16), 0);
      // Le haut de l'épaule (deltoïde, trapèze) suit un peu le bras de son côté.
      const arm = x < 0 ? BONE.armL : BONE.armR;
      const ox = REF_OFFSETS[arm * 3]!, oy = REF_OFFSETS[arm * 3 + 1]!;
      take(arm, 0.35 * fade(Math.hypot(x - ox, y - oy, z) - 0.04, 0.09), 1);
      break;
    }
    case BONE.head:
      take(BONE.torso, 0.5 * fade(y + 0.03, 0.08), 0);
      break;
    case BONE.pelvis:
      // Bas du bassin, jupe, pans de manteau : suivent en partie la cuisse de leur côté.
      take(x < 0 ? BONE.thighL : BONE.thighR, 0.4 * smoothstep(0.02, 0.1, Math.abs(x)) * smoothstep(0, 0.12, -y), 1);
      break;
  }
  out[0] = other;
  out[1] = w;
  out[2] = pivot;
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
    const ox = offsets[b * 3]! + (b === 0 ? pose.rootDx : 0), oy = offsets[b * 3 + 1]! + (b === 0 ? pose.rootDy : 0), oz = offsets[b * 3 + 2]!;
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

/**
 * Assis (D198), `t` s après s'être assis : cuisses à l'horizontale, jambes pendantes, mains posées sur les cuisses, buste droit ; le bassin
 * descend à 52 cm au-dessus du sol du personnage (l'assise est à 45 cm). Les 0,4 premières secondes, il s'assoit (on plie les genoux).
 */
export function sitPose(pose: Pose, t: number, d: BodyDims): void {
  const a = pose.angles;
  a.fill(0);
  pose.rootDx = 0;
  const f = smooth(t / 0.4);
  for (const [thigh, shin, foot, side] of [[BONE.thighL, BONE.shinL, BONE.footL, -1], [BONE.thighR, BONE.shinR, BONE.footR, 1]] as const) {
    a[thigh * 3] = 1.45 * f;
    a[thigh * 3 + 2] = side * 0.08 * f;
    a[shin * 3] = -1.4 * f;
    a[foot * 3] = -0.05 * f;
  }
  for (const [arm, fore, side] of [[BONE.armL, BONE.forearmL, -1], [BONE.armR, BONE.forearmR, 1]] as const) {
    a[arm * 3] = 0.35 * f;
    a[arm * 3 + 2] = side * 0.12;
    a[fore * 3] = 0.95 * f;
  }
  a[BONE.torso * 3] = 0.06 * f - d.stoop;
  a[BONE.head * 3] = 0.1 * f;
  pose.rootDy = (0.52 - d.hipY) * f;
}

/** Téléphone en main (D198), par-dessus la pose de marche ou d'arrêt : la main droite tient le téléphone devant la poitrine, la tête penchée dessus. */
export function phonePose(pose: Pose): void {
  const a = pose.angles;
  a[BONE.armR * 3] = 0.4;
  a[BONE.armR * 3 + 1] = 0.75;
  a[BONE.armR * 3 + 2] = 0.08;
  a[BONE.forearmR * 3] = 2.45;
  a[BONE.head * 3]! -= 0.35;
}

/** Discussion (D198), par-dessus la pose d'arrêt : les avant-bras bougent doucement, l'un après l'autre (`t` en s). */
export function talkPose(pose: Pose, t: number): void {
  const a = pose.angles;
  a[BONE.armL * 3] = 0.25 + 0.15 * Math.sin(t * 2.1);
  a[BONE.armR * 3] = 0.25 + 0.15 * Math.sin(t * 1.7 + 1.3);
  a[BONE.forearmL * 3] = 0.9 + 0.35 * Math.sin(t * 2.6 + 0.4);
  a[BONE.forearmR * 3] = 0.9 + 0.35 * Math.sin(t * 2.3 + 2.1);
  a[BONE.head * 3 + 1]! += 0.15 * Math.sin(t * 0.9);
}
