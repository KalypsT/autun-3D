import * as THREE from "three";
import type { Recipe } from "../core/character";
import { recipeColors } from "../core/character";
import { PART_SPECS, SLOT_COUNT, type PartSpec } from "../core/character-kit";
import { REF_DIMS } from "../core/character-rig";
import { atlasUv, REGIONS, SHAPE_REGION } from "./character-texture";
import { box, cap, ellipsoid, loft, placed, radiusAt, shapedEllipsoid, sliceProfile, type Ring, type RGB, merge, untextured, WHITE } from "./character-shapes";

/**
 * Formes du catalogue de pièces (`src/core/character-kit.ts`), dessinées sur le corps de référence (1,75 m, adulte moyen)
 * dans le repère de l'os qui les porte : l'origine est l'articulation, y vers le haut, le visage regarde vers −z.
 * Deux niveaux de détail : 0 (près, visage et accessoires) et 1 (loin, formes simples à peu de facettes).
 */

export type Lod = 0 | 1;
type Profile = readonly (readonly [number, number])[];

const R = REF_DIMS;
/** Centre de la tête dans le repère de l'os de la tête (l'origine est à la base du cou). */
const HC = R.headCenterY - (R.neckY - 0.015 * R.height);
const HEAD_R: readonly [number, number, number] = [0.082, 0.1155, 0.098];
/** Sens de la face dans le plan horizontal (longitude de la sphère : z = sin φ, face vers −z). */
const FRONT = -Math.PI / 2;

const SKIN_SHADE: RGB = [0.95, 0.88, 0.84];

// Profils (hauteur dans le repère de l'os, rayon) des membres, de l'articulation vers l'extrémité : cuisse qui s'affine vers le genou,
// mollet, biceps, avant-bras qui s'affine vers le poignet. Le haut du bras est un dôme (le deltoïde) qui arrondit l'épaule.
const THIGH: Profile = [[0.03, 0.058], [0, 0.074], [-0.11, 0.082], [-0.2, 0.077], [-0.32, 0.061], [-R.thigh, 0.053]];
const SHIN: Profile = [[0, 0.053], [-0.1, 0.058], [-0.18, 0.053], [-0.28, 0.041], [-0.37, 0.034], [-R.shin, 0.034]];
const UPPER_ARM: Profile = [[0.032, 0.016], [0.024, 0.037], [0.006, 0.049], [-0.06, 0.05], [-0.18, 0.044], [-R.upperArm, 0.037]];
const FOREARM: Profile = [[0, 0.038], [-0.06, 0.042], [-0.17, 0.034], [-R.forearm, 0.026]];

/**
 * Torse (repère du bassin : l'origine est à la hauteur des hanches, le visage regarde vers −z) : taille, côtes, poitrine (avancée vers −z),
 * épaules arrondies, pente des trapèzes jusqu'au cou. Sections en super-ellipse : plus pleines qu'une ellipse, sans arêtes.
 */
const TORSO_RINGS: readonly Ring[] = [
  { y: -0.07, rx: 0.164, rz: 0.108, cz: 0.004 },
  { y: 0, rx: 0.153, rz: 0.106, cz: 0.002 },
  { y: 0.08, rx: 0.146, rz: 0.103, cz: -0.003, p: 2.2 },
  { y: 0.16, rx: 0.147, rz: 0.104, p: 2.3 },
  { y: 0.25, rx: 0.163, rz: 0.112, cz: -0.005, p: 2.4 },
  { y: 0.33, rx: 0.178, rz: 0.119, cz: -0.009, p: 2.5 },
  { y: 0.4, rx: 0.188, rz: 0.12, cz: -0.008, p: 2.5 },
  { y: 0.45, rx: 0.198, rz: 0.113, cz: -0.002, p: 2.4 },
  { y: 0.49, rx: 0.198, rz: 0.1, cz: 0.006, p: 2.4 },
  { y: 0.515, rx: 0.178, rz: 0.09, cz: 0.01, p: 2.2 },
  { y: 0.537, rx: 0.12, rz: 0.073, cz: 0.01 },
  { y: 0.553, rx: 0.065, rz: 0.057, cz: 0.008 },
];
/** Anneaux gardés au loin (indices de TORSO_RINGS). */
const TORSO_FAR = [0, 3, 5, 7, 9, 11];

/**
 * Poitrine du torse féminin (hauteur, profondeur des galbes) : le sillon dessous monte vite, le haut redescend en pente douce vers
 * les clavicules. Modelée dans la surface du torse, sans pièce rapportée : ni arête ni ligne d'ombre.
 */
const BUST_PROFILE: readonly (readonly [number, number])[] = [[0.27, 0], [0.3, 0.016], [0.325, 0.031], [0.35, 0.038], [0.38, 0.034], [0.415, 0.019], [0.45, 0.005], [0.48, 0]];
const bustAt = (y: number): number => (y <= 0.27 || y >= 0.48 ? 0 : radiusAt(BUST_PROFILE, y));

const PELVIS_RINGS: readonly Ring[] = [
  { y: -0.155, rx: 0.085, rz: 0.065, cz: 0.005 },
  { y: -0.115, rx: 0.16, rz: 0.098, cz: 0.012 },
  { y: -0.05, rx: 0.172, rz: 0.106, cz: 0.012, p: 2.2 },
  { y: 0, rx: 0.166, rz: 0.104, cz: 0.006 },
  { y: 0.03, rx: 0.15, rz: 0.102, cz: 0.004 },
];

/** Anneaux d'un profil de membre ; au loin, on garde un anneau sur deux (et toujours le premier et le dernier). */
const profileRings = (p: Profile, scale = 1, lod: Lod = 0): Ring[] => {
  const sorted = [...p].sort((a, b) => a[0] - b[0]);
  const kept = lod === 1 ? sorted.filter((_, i) => i % 2 === 0 || i === sorted.length - 1) : sorted;
  return kept.map(([y, r]) => ({ y, rx: r * scale, rz: r * scale }));
};
/** Anneau du torse interpolé à la hauteur y, agrandi de `grow` (bandes, cols) ; `female` : avec la poitrine. */
const torsoRingAt = (y: number, grow = 1, female = false): Ring => {
  const at = (f: (r: Ring) => number): number => radiusAt(TORSO_RINGS.map((r) => [r.y, f(r)] as const), y);
  const ring: Ring = { y, rx: at((r) => r.rx) * grow, rz: at((r) => r.rz) * grow, cz: at((r) => r.cz ?? 0), p: at((r) => r.p ?? 2) };
  if (female && bustAt(y) > 0) ring.bust = bustAt(y) * grow;
  return ring;
};
/** Torse féminin : les anneaux du torse, plus serrés là où passe la poitrine. */
const FEMALE_TORSO: readonly Ring[] = [
  ...TORSO_RINGS.filter((r) => r.y < 0.27 || r.y > 0.48),
  ...BUST_PROFILE.map(([y]) => torsoRingAt(y, 1, true)),
].sort((a, b) => a.y - b.y);
const FEMALE_TORSO_FAR: readonly Ring[] = [0, 3, 5].map((i) => TORSO_RINGS[i]!).concat([torsoRingAt(0.35, 1, true), TORSO_RINGS[7]!, TORSO_RINGS[9]!, TORSO_RINGS[11]!]);

interface Ctx {
  /** Nombre de côtés d'un membre. */
  seg: number;
  lod: Lod;
}

type Shape = (c: Ctx) => THREE.BufferGeometry | null;

/** Pièces de peau et de tissu qui épousent un profil de membre. */
const limb = (profile: Profile, scale: number, c: Ctx, caps = false): THREE.BufferGeometry =>
  loft(profileRings(profile, scale, c.lod), c.seg, { capBottom: caps, capTop: caps });

const hairRim = (lo: number, hi: number) => (phi: number): number => lo + (hi - lo) * 0.5 * (1 - Math.cos(phi - FRONT));
const flat = (v: number) => (): number => v;
const TAU = Math.PI * 2;
/** Calotte qui épouse la tête, agrandie de `grow`, du sommet jusqu'à une lisière qui descend vers la nuque. */
function skullCap(c: Ctx, grow: number, front: number, back: number, color: RGB = WHITE): THREE.BufferGeometry {
  const steps = c.lod === 0 ? 16 : 6;
  return cap(0, HC, 0, HEAD_R[0] * grow, HEAD_R[1] * grow, HEAD_R[2] * grow, flat(0), hairRim(front * Math.PI, back * Math.PI), 0, TAU, steps, c.lod === 0 ? 5 : 2, color);
}

/**
 * Tête : l'ellipsoïde du crâne, resserré sous les pommettes (mâchoire) et derrière la mâchoire (vers le cou). On ne fait que rentrer
 * la surface : les cheveux, chapeaux et barbes dessinés sur l'ellipsoïde la couvrent toujours.
 */
function shapeHead(v: THREE.Vector3): void {
  if (v.y >= 0) return;
  const t = Math.min(1, -v.y / HEAD_R[1]);
  v.x *= 1 - 0.2 * t * t;
  if (v.z > 0) v.z *= 1 - 0.28 * t * t;
}

/**
 * Chaussure (repère du pied : l'origine est la cheville) : sections le long du pied, du talon (+z) à la pointe (−z), dessous à plat
 * à `bottom`. `grow` élargit (semelle qui déborde), `top` limite la hauteur (semelle seule).
 */
function shoe(c: Ctx, grow = 1, bottom = -0.07, top = Infinity, color: RGB = WHITE): THREE.BufferGeometry {
  // [position le long du pied (vers la pointe), demi-largeur, hauteur]
  const sections: readonly (readonly [number, number, number])[] = c.lod === 0
    ? [[-0.072, 0.024, 0.05], [-0.058, 0.04, 0.072], [0.0, 0.046, 0.077], [0.09, 0.05, 0.055], [0.16, 0.044, 0.042], [0.2, 0.024, 0.027]]
    : [[-0.07, 0.03, 0.06], [0.0, 0.046, 0.076], [0.12, 0.049, 0.05], [0.2, 0.025, 0.028]];
  const rings: Ring[] = sections.map(([t, w, h]) => {
    const hh = Math.min(h, top) * 0.5;
    return { y: t, rx: w * grow, rz: hh * grow, cz: bottom + hh, p: 2.6 };
  });
  // Les anneaux sont empilés le long de y : on couche la forme pour que y devienne −z (vers la pointe) et z la hauteur.
  const g = loft(rings, c.lod === 0 ? 8 : 5, { capBottom: true, capTop: true, color });
  g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1));
  return g;
}

/** Bandes réfléchissantes du gilet de chantier, posées sur le torse (féminin : elles épousent la poitrine). */
function reflectiveStripes(female: boolean): THREE.BufferGeometry {
  const band = (y0: number, y1: number): THREE.BufferGeometry =>
    loft([torsoRingAt(y0, 1.04, female), torsoRingAt(y1, 1.04, female)], female ? 20 : 16, { color: [0.88, 0.88, 0.8] });
  return merge([band(0.1, 0.15), band(0.28, 0.33)]);
}

const SHAPES: Record<string, Shape> = {
  head: (c) => {
    const near = c.lod === 0;
    const parts = [shapedEllipsoid(0, HC, 0, HEAD_R[0], HEAD_R[1], HEAD_R[2], near ? 14 : 7, near ? 10 : 5, shapeHead)];
    if (near) {
      // Nez et oreilles en volume ; yeux, sourcils et bouche sont peints sur la tête (`character-texture.ts`).
      parts.push(...[
        placed(ellipsoid(0, 0, 0, 0.01, 0.026, 0.013, 5, 3, SKIN_SHADE), 0, HC - 0.008, -0.094, -0.25),
        ellipsoid(0.08, HC - 0.004, 0.012, 0.01, 0.024, 0.016, 5, 3, SKIN_SHADE), ellipsoid(-0.08, HC - 0.004, 0.012, 0.01, 0.024, 0.016, 5, 3, SKIN_SHADE),
      ].map(untextured));
    }
    return merge(parts);
  },
  neck: (c) => loft([{ y: -0.06, rx: 0.054, rz: 0.05 }, { y: 0.0, rx: 0.05, rz: 0.047, cz: 0.004 }, { y: 0.07, rx: 0.046, rz: 0.045, cz: 0.006 }], c.seg),
  // Main au repos, paume vers la cuisse : paume, doigts un peu repliés, pouce vers l'avant.
  hands: (c) => {
    const y = -R.forearm;
    if (c.lod === 1) return ellipsoid(0, y - 0.06, 0, 0.022, 0.065, 0.04, 6, 4);
    return merge([
      // Paume et doigts d'un seul tenant, un peu repliés vers l'arrière (+z) en bas.
      placed(ellipsoid(0, 0, 0, 0.018, 0.068, 0.034, 8, 6), 0, y - 0.07, 0.004, -0.12),
      placed(ellipsoid(0, 0, 0, 0.012, 0.03, 0.012, 5, 3), 0, y - 0.05, -0.034, 0.35),
    ]);
  },
  armSkinUpper: (c) => loft(profileRings(UPPER_ARM, 1, c.lod), c.seg, { capTop: true }),
  armSkinFore: (c) => limb(FOREARM, 1, c),
  thighSkinLower: (c) => loft(profileRings(sliceProfile(THIGH, -R.thigh, -0.18), 1, c.lod), c.seg),
  thighSkinFull: (c) => limb(THIGH, 1, c),
  shinSkin: (c) => limb(SHIN, 1, c),

  torso: (c) => loft(c.lod === 0 ? TORSO_RINGS : TORSO_FAR.map((i) => TORSO_RINGS[i]!), c.lod === 0 ? 14 : 7, { capTop: true }),
  // Torse féminin : poitrine modelée dans la surface ; plus de côtés devant pour suivre les deux galbes.
  torsoF: (c) => loft(c.lod === 0 ? FEMALE_TORSO : FEMALE_TORSO_FAR, c.lod === 0 ? 20 : 9, { capTop: true }),
  apronPanel: (c) => merge([box(0.25, 0.74, 0.02, 0, 0.02, -0.135), ...(c.lod === 0 ? [box(0.035, 0.22, 0.012, 0, 0.44, -0.12)] : [])]),
  stripes: () => reflectiveStripes(false),
  stripesF: () => reflectiveStripes(true),
  collar: (c) => loft([{ y: 0.51, rx: 0.088, rz: 0.077, cz: 0.008 }, { y: 0.55, rx: 0.074, rz: 0.067, cz: 0.008 }, { y: 0.585, rx: 0.064, rz: 0.06, cz: 0.008 }], c.seg),
  hood: () => ellipsoid(0, 0.555, 0.075, 0.1, 0.075, 0.07, 10, 6),
  hemJacket: (c) => loft([{ y: -0.17, rx: 0.175, rz: 0.126, cz: 0.01 }, { y: -0.05, rx: 0.17, rz: 0.12, cz: 0.012 }, { y: 0.06, rx: 0.162, rz: 0.113, cz: 0.006 }], c.seg + 4),
  hemCoat: (c) => loft([{ y: -0.5, rx: 0.215, rz: 0.165 }, { y: -0.3, rx: 0.2, rz: 0.15, cz: 0.006 }, { y: -0.05, rx: 0.17, rz: 0.12, cz: 0.012 }, { y: 0.06, rx: 0.162, rz: 0.113, cz: 0.006 }], c.seg + 4),
  sleeveShort: (c) => loft(profileRings(sliceProfile(UPPER_ARM, -0.14, 0.032), 1.09, c.lod), c.seg, { capTop: true }),
  sleeveLong: (c) => loft(profileRings(sliceProfile(UPPER_ARM, -R.upperArm + 0.005, 0.032), 1.09, c.lod), c.seg, { capTop: true }),
  foreSleeve: (c) => loft(profileRings(sliceProfile(FOREARM, -R.forearm + 0.02, 0.005), 1.1, c.lod), c.seg),

  // Le bord haut reste sous la coque du torse (qui descend à −0,07) pour ne pas dépasser sur les hanches ; fesses vers +z.
  pelvis: (c) => loft(c.lod === 0 ? PELVIS_RINGS : [PELVIS_RINGS[0]!, PELVIS_RINGS[2]!, PELVIS_RINGS[4]!], c.seg + 2, { capBottom: true }),
  skirt: (c) => loft([{ y: -0.4, rx: 0.235, rz: 0.19 }, { y: -0.25, rx: 0.215, rz: 0.17, cz: 0.006 }, { y: -0.05, rx: 0.17, rz: 0.12, cz: 0.012 }, { y: 0.08, rx: 0.162, rz: 0.113, cz: 0.006 }], c.seg + 4),
  thighCloth: (c) => limb(THIGH, 1.07, c),
  shinCloth: (c) => loft(profileRings(sliceProfile(SHIN, -R.shin + 0.03, 0), 1.08, c.lod), c.seg),
  thighShorts: (c) => loft(profileRings(sliceProfile(THIGH, -0.19, 0.03), 1.12, c.lod), c.seg),

  foot: (c) => shoe(c),
  sole: (c) => shoe(c, 1.06, -0.074, 0.016, [0.95, 0.93, 0.88]),
  bootShaft: (c) => loft([{ y: -0.4, rx: 0.05, rz: 0.054 }, { y: -0.28, rx: 0.056, rz: 0.06 }, { y: -0.16, rx: 0.058, rz: 0.062 }], c.seg),

  hairBuzz: (c) => skullCap(c, 1.02, 0.3, 0.5),
  hairShort: (c) => skullCap(c, 1.07, 0.3, 0.62),
  hairSide: (c) => merge([skullCap(c, 1.07, 0.3, 0.62), ...(c.lod === 0 ? [ellipsoid(-0.03, HC + 0.1, -0.03, 0.05, 0.03, 0.07, 5, 3)] : [])]),
  hairCurly: (c) => {
    const parts = [skullCap(c, 1.08, 0.3, 0.64)];
    if (c.lod === 0) {
      for (const [x, y, z] of [[0.05, 0.1, -0.03], [-0.05, 0.1, -0.03], [0.07, 0.04, 0.03], [-0.07, 0.04, 0.03], [0, 0.11, 0.04], [0.04, 0, 0.09], [-0.04, 0, 0.09]] as const) {
        parts.push(ellipsoid(x, HC + y, z, 0.036, 0.034, 0.036, 5, 3));
      }
    }
    return merge(parts);
  },
  hairBob: (c) => skullCap(c, 1.1, 0.3, 0.82),
  hairLong: (c) => merge([
    skullCap(c, 1.1, 0.3, 0.86),
    loft([{ y: HC - 0.38, rx: 0.07, rz: 0.035, cz: 0.1 }, { y: HC - 0.2, rx: 0.088, rz: 0.04, cz: 0.1 }, { y: HC, rx: 0.095, rz: 0.04, cz: 0.095 }], c.lod === 0 ? 8 : 5),
  ]),
  hairPonytail: (c) => merge([
    skullCap(c, 1.08, 0.3, 0.6),
    placed(loft([{ y: -0.2, rx: 0.02, rz: 0.02 }, { y: -0.08, rx: 0.034, rz: 0.034 }, { y: 0, rx: 0.026, rz: 0.026 }], 6), 0, HC + 0.04, 0.115, -0.7),
  ]),
  hairBun: (c) => merge([skullCap(c, 1.07, 0.3, 0.6), ellipsoid(0, HC + 0.1, 0.065, 0.045, 0.045, 0.045, 6, 4)]),

  hatCap: (c) => merge([skullCap(c, 1.1, 0.3, 0.46), placed(ellipsoid(0, 0, 0, 0.074, 0.006, 0.066, 6, 2), 0, HC + 0.05, -0.12, 0.15)]),
  hatBeanie: (c) => skullCap(c, 1.12, 0.36, 0.55),
  hatFedora: () => merge([
    loft([{ y: HC + 0.06, rx: 0.09, rz: 0.1 }, { y: HC + 0.15, rx: 0.076, rz: 0.088 }], 8, { capTop: true }),
    loft([{ y: HC + 0.058, rx: 0.17, rz: 0.17 }, { y: HC + 0.064, rx: 0.17, rz: 0.17 }], 10, { capBottom: true, capTop: true }),
  ]),
  hatBeret: () => merge([ellipsoid(0.02, HC + 0.095, 0, 0.125, 0.04, 0.115, 8, 4), box(0.012, 0.02, 0.012, 0.02, HC + 0.135, 0)]),
  hatHelmet: (c) => merge([
    skullCap(c, 1.15, 0.33, 0.5),
    loft([{ y: HC + 0.05, rx: 0.14, rz: 0.145 }, { y: HC + 0.056, rx: 0.14, rz: 0.145 }], 10, { capBottom: true, capTop: true }),
  ]),

  glassesClear: (c) => {
    if (c.lod === 1) return null;
    const frame = (x: number): THREE.BufferGeometry => {
      const t = new THREE.TorusGeometry(0.0185, 0.0028, 3, 8);
      t.translate(x, HC + 0.022, -0.0925);
      return t as THREE.BufferGeometry;
    };
    const d: RGB = [0.1, 0.09, 0.09];
    return merge([
      finishTorus(frame(0.032), d), finishTorus(frame(-0.032), d),
      box(0.02, 0.004, 0.004, 0, HC + 0.026, -0.0915, d),
      box(0.004, 0.004, 0.1, 0.0735, HC + 0.026, -0.04, d), box(0.004, 0.004, 0.1, -0.0735, HC + 0.026, -0.04, d),
    ]);
  },
  glassesSun: (c) => {
    if (c.lod === 1) return null;
    const d: RGB = [0.04, 0.04, 0.06];
    return merge([
      box(0.046, 0.03, 0.008, 0.032, HC + 0.022, -0.092, d), box(0.046, 0.03, 0.008, -0.032, HC + 0.022, -0.092, d),
      box(0.02, 0.006, 0.006, 0, HC + 0.03, -0.092, d),
      box(0.004, 0.006, 0.1, 0.0735, HC + 0.026, -0.04, d), box(0.004, 0.006, 0.1, -0.0735, HC + 0.026, -0.04, d),
    ]);
  },
  stubble: (c) => (c.lod === 1 ? null : cap(0, HC, 0, HEAD_R[0] * 1.03, HEAD_R[1] * 1.03, HEAD_R[2] * 1.03, flat(0.64 * Math.PI), flat(0.9 * Math.PI), FRONT - 1.2, FRONT + 1.2, 8, 2, [0.78, 0.76, 0.76])),
  mustache: (c) => (c.lod === 1 ? null : box(0.056, 0.012, 0.016, 0, HC - 0.04, -0.094)),
  beard: (c) => (c.lod === 1 ? null : cap(0, HC, 0, HEAD_R[0] * 1.07, HEAD_R[1] * 1.07, HEAD_R[2] * 1.07, flat(0.55 * Math.PI), flat(0.95 * Math.PI), FRONT - 1.35, FRONT + 1.35, 9, 3)),

  backpack: (c) => merge([
    box(0.3, 0.36, 0.13, 0, 0.3, 0.19),
    ...(c.lod === 0 ? [box(0.035, 0.28, 0.012, 0.125, 0.34, -0.118), box(0.035, 0.28, 0.012, -0.125, 0.34, -0.118)] : []),
  ]),
  shoulderBag: (c) => merge([
    box(0.28, 0.2, 0.09, -0.03, -0.02, 0.165),
    ...(c.lod === 0 ? [placed(box(0.035, 0.7, 0.012, 0, 0, 0), 0, 0.2, -0.122, 0, 0, -0.62)] : []),
  ]),
  handbag: (c) => merge([box(0.2, 0.15, 0.07, 0.01, -R.forearm - 0.13, 0), ...(c.lod === 0 ? [box(0.012, 0.1, 0.012, 0.01, -R.forearm - 0.045, 0)] : [])]),
  // Armes tenues dans la main droite (repère de l'avant-bras : l'origine est le coude, la main est à y = −forearm − 0,045). Le manche traverse le poing,
  // la lame ou le fût prolonge l'avant-bras. Un peu plus gros que nature : de la caméra, à 3,6 m, il faut qu'on le lise.
  weaponKnife: () => {
    const y = -R.forearm - 0.045;
    return merge([
      box(0.034, 0.12, 0.034, 0, y, 0, [0.16, 0.12, 0.1]),
      box(0.05, 0.02, 0.07, 0, y - 0.07, 0, [0.35, 0.3, 0.25]),
      box(0.012, 0.28, 0.052, 0, y - 0.22, 0, [0.88, 0.9, 0.94]),
    ]);
  },
  weaponBat: () => {
    const y = -R.forearm - 0.045;
    return loft([
      { y: y - 0.78, rx: 0.05, rz: 0.05 }, { y: y - 0.5, rx: 0.045, rz: 0.045 }, { y: y - 0.2, rx: 0.026, rz: 0.026 },
      { y: y + 0.1, rx: 0.02, rz: 0.02 }, { y: y + 0.14, rx: 0.03, rz: 0.03 },
    ], 8, { capBottom: true, capTop: true, color: [0.74, 0.52, 0.3] });
  },
  // Armes à feu : le canon prolonge l'avant-bras (−y), la crosse reste vers le coude. Gris foncé et bois : quelques boîtes chacune.
  weaponPistol: () => {
    const y = -R.forearm - 0.045;
    return merge([
      box(0.04, 0.11, 0.05, 0, y + 0.02, 0.02, [0.12, 0.12, 0.14]),
      box(0.045, 0.2, 0.06, 0, y - 0.1, -0.03, [0.22, 0.23, 0.27]),
      box(0.02, 0.05, 0.02, 0, y - 0.215, -0.065, [0.7, 0.72, 0.76]),
    ]);
  },
  weaponShotgun: () => {
    const y = -R.forearm - 0.045;
    return merge([
      box(0.055, 0.34, 0.07, 0, y + 0.22, 0.02, [0.62, 0.42, 0.24]),
      box(0.06, 0.16, 0.075, 0, y - 0.02, -0.02, [0.18, 0.18, 0.2]),
      box(0.04, 0.55, 0.045, 0, y - 0.38, -0.03, [0.26, 0.27, 0.3]),
      box(0.05, 0.2, 0.06, 0, y - 0.26, 0.02, [0.62, 0.42, 0.24]),
    ]);
  },
  weaponRifle: () => {
    const y = -R.forearm - 0.045;
    return merge([
      box(0.05, 0.3, 0.075, 0, y + 0.24, 0.02, [0.22, 0.23, 0.2]),
      box(0.06, 0.3, 0.09, 0, y - 0.07, -0.01, [0.18, 0.19, 0.2]),
      box(0.032, 0.42, 0.034, 0, y - 0.4, -0.025, [0.28, 0.29, 0.32]),
      box(0.045, 0.14, 0.08, 0, y - 0.0, 0.1, [0.14, 0.14, 0.16]),
      box(0.03, 0.1, 0.03, 0, y - 0.64, -0.025, [0.12, 0.12, 0.14]),
    ]);
  },
  scarf: (c) => merge([
    loft([{ y: 0.49, rx: 0.088, rz: 0.082 }, { y: 0.52, rx: 0.1, rz: 0.092 }, { y: 0.555, rx: 0.09, rz: 0.084 }], c.seg),
    ...(c.lod === 0 ? [box(0.07, 0.24, 0.025, 0.03, 0.38, -0.12)] : []),
  ]),
};

/** Les anneaux de lunettes viennent de THREE.TorusGeometry : on les ramène au format commun. */
function finishTorus(g: THREE.BufferGeometry, color: RGB): THREE.BufferGeometry {
  const geo = untextured(g.toNonIndexed());
  g.dispose();
  geo.computeVertexNormals();
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(color, i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Ramène les uv d'une forme (0 à 1 dans la forme) à sa place sur la feuille de texture ; sans place, tout lit le texel blanc. */
function placeInAtlas(g: THREE.BufferGeometry, rect: readonly [number, number, number, number] | null): void {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = atlasUv(rect, uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
}

const cache = new Map<string, THREE.BufferGeometry | null>();

/** Forme du catalogue au niveau de détail demandé (mise en cache), ou null si la pièce disparaît à ce niveau. */
export function shapeGeometry(shape: string, lod: Lod): THREE.BufferGeometry | null {
  const key = `${shape}/${lod}`;
  if (cache.has(key)) return cache.get(key)!;
  const build = SHAPES[shape];
  if (!build) throw new Error(`forme inconnue : ${shape}`);
  const g = build({ seg: lod === 0 ? 10 : 5, lod });
  if (g) placeInAtlas(g, SHAPE_REGION[shape] ? REGIONS[SHAPE_REGION[shape]]! : null);
  cache.set(key, g);
  return g;
}

/** Pièce affichée à ce niveau de détail : le niveau 1 écarte les pièces non marquées `far`. */
export function partGeometry(spec: PartSpec, lod: Lod): THREE.BufferGeometry | null {
  if (lod === 1 && !spec.far) return null;
  return shapeGeometry(spec.shape, lod);
}

/** Couleurs d'emplacement d'une recette (espace de travail linéaire de three), 8 × 3 valeurs. */
export function slotColors(r: Recipe, out: Float32Array = new Float32Array(SLOT_COUNT * 3)): Float32Array {
  const c = recipeColors(r);
  const col = new THREE.Color();
  // Même ordre que SLOT : peau, cheveux, haut, bas, chaussures, chapeau, sac, écharpe.
  const list = [c.skin, c.hair, c.top, c.bottom, c.shoes, c.hat, c.bag, c.scarf];
  list.forEach((hex, i) => {
    col.set(hex);
    out[i * 3] = col.r;
    out[i * 3 + 1] = col.g;
    out[i * 3 + 2] = col.b;
  });
  return out;
}

/** Pièces visibles d'une recette avec leur géométrie au niveau de détail demandé (outil de test et de fabrication). */
export function recipeParts(r: Recipe, lod: Lod): { spec: PartSpec; index: number; geometry: THREE.BufferGeometry }[] {
  const out: { spec: PartSpec; index: number; geometry: THREE.BufferGeometry }[] = [];
  PART_SPECS.forEach((spec, index) => {
    if (!spec.when(r)) return;
    const geometry = partGeometry(spec, lod);
    if (geometry) out.push({ spec, index, geometry });
  });
  return out;
}

export function disposeShapeCache(): void {
  for (const g of cache.values()) g?.dispose();
  cache.clear();
}
