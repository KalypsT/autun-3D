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
/** Durée totale d'une chute : 0,35 s pour tomber, environ 2,3 s au sol, 0,9 s pour se relever. */
export const DOWN_TIME = 3.6;
const FALL_TIME = 0.35, GETUP_TIME = 0.9;
/** Instant d'une chute où le corps est à terre, immobile : la pose que garde un mort (D209). */
export const LYING_T = DOWN_TIME - GETUP_TIME - 0.5;
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
  restOffsets(d, fkOffsets);
  solveBones(fkRender, fkWorld, fkOffsets, ONES, pose, ORIGIN);
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

const lieTmp = createPose();

/**
 * Pose d'un passant heurté, `t` secondes après le choc. `kind` : trébuchement (penché, bras en avant, retrouve l'équilibre) ou chute (tombe en
 * `FALL_TIME`, reste à terre, se relève). `side` : +1 il tombe sur le dos (choc de face), −1 vers l'avant (choc par derrière).
 * D209 : la pose part de `from` (la pose d'avant le choc : marche, course, deux-roues ; debout si absente) par un fondu de `HIT_BLEND` s, et
 * revient à la pose debout immobile, d'où la marche reprend sans saut. Au sol, l'une des `LYING_VARIANTS` poses (`variant`), le corps posé à plat :
 * le point le plus bas du corps touche le sol pendant toute la chute (le corps bascule sur les pieds, puis repose sur le dos ou le ventre).
 */
export function hitPose(pose: Pose, kind: number, t: number, side: number, d: BodyDims, from: Pose | null = null, variant = 0): void {
  const a = pose.angles;
  standPose(pose, d);
  if (kind === HIT_POSE.stumble) {
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
  const f = t < FALL_TIME ? smooth(t / FALL_TIME) : t < DOWN_TIME - GETUP_TIME ? 1 : 1 - smooth((t - (DOWN_TIME - GETUP_TIME)) / GETUP_TIME);
  if (f > 0) {
    lyingPose(lieTmp, side, variant);
    blendPose(pose, pose, lieTmp, f);
  }
  if (from && t < HIT_BLEND) blendPose(pose, from, pose, smooth(t / HIT_BLEND));
  // Le corps repose sur son point le plus bas : les pieds au début de la chute, le dos ou le ventre une fois à terre.
  pose.rootDx = 0;
  pose.rootDy = 0;
  pose.rootDy = -lowestPoint(pose, d);
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
