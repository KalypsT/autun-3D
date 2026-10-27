import * as THREE from "three";
import type { Recipe } from "../core/character";
import { recipeColors } from "../core/character";
import { PART_SPECS, SLOT_COUNT, type PartSpec } from "../core/character-kit";
import { REF_DIMS } from "../core/character-rig";
import { box, cap, ellipsoid, loft, placed, radiusAt, sliceProfile, type Ring, type RGB, merge, WHITE } from "./character-shapes";

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
const DARK: RGB = [0.1, 0.08, 0.07];
const BROW: RGB = [0.32, 0.24, 0.2];
const MOUTH: RGB = [0.78, 0.4, 0.4];

// Profils (hauteur dans le repère de l'os, rayon) des membres, de l'articulation vers l'extrémité.
const THIGH: Profile = [[0.02, 0.08], [0, 0.088], [-0.12, 0.082], [-0.3, 0.063], [-R.thigh, 0.054]];
const SHIN: Profile = [[0, 0.055], [-0.09, 0.059], [-0.22, 0.05], [-0.35, 0.04], [-R.shin, 0.037]];
const UPPER_ARM: Profile = [[0.035, 0.046], [0, 0.05], [-0.1, 0.048], [-0.25, 0.042], [-R.upperArm, 0.039]];
const FOREARM: Profile = [[0, 0.04], [-0.07, 0.042], [-0.18, 0.034], [-R.forearm, 0.028]];

const TORSO_RINGS: readonly Ring[] = [
  { y: -0.07, rx: 0.163, rz: 0.112 },
  { y: 0, rx: 0.16, rz: 0.11 },
  { y: 0.14, rx: 0.152, rz: 0.105 },
  { y: 0.3, rx: 0.19, rz: 0.122 },
  { y: 0.43, rx: 0.215, rz: 0.115 },
  { y: 0.505, rx: 0.19, rz: 0.09 },
  { y: 0.535, rx: 0.07, rz: 0.06 },
];

/** Anneaux d'un profil de membre ; au loin, on ne garde que le premier, le milieu et le dernier. */
const profileRings = (p: Profile, scale = 1, lod: Lod = 0): Ring[] => {
  const sorted = [...p].sort((a, b) => a[0] - b[0]);
  const kept = lod === 1 && sorted.length > 3 ? [sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!] : sorted;
  return kept.map(([y, r]) => ({ y, rx: r * scale, rz: r * scale }));
};
const torsoRadiusAt = (y: number): [number, number] => [
  radiusAt(TORSO_RINGS.map((r) => [r.y, r.rx] as const), y),
  radiusAt(TORSO_RINGS.map((r) => [r.y, r.rz] as const), y),
];

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
  const steps = c.lod === 0 ? 12 : 6;
  return cap(0, HC, 0, HEAD_R[0] * grow, HEAD_R[1] * grow, HEAD_R[2] * grow, flat(0), hairRim(front * Math.PI, back * Math.PI), 0, TAU, steps, c.lod === 0 ? 4 : 2, color);
}

const SHAPES: Record<string, Shape> = {
  head: (c) => {
    const w = c.lod === 0 ? 10 : 6, h = c.lod === 0 ? 7 : 4;
    const parts = [ellipsoid(0, HC, 0, HEAD_R[0], HEAD_R[1], HEAD_R[2], w, h)];
    if (c.lod === 0) {
      parts.push(
        ellipsoid(0, HC - 0.012, -0.098, 0.011, 0.016, 0.018, 4, 3, SKIN_SHADE),
        box(0.016, 0.011, 0.008, 0.031, HC + 0.022, -0.0885, DARK), box(0.016, 0.011, 0.008, -0.031, HC + 0.022, -0.0885, DARK),
        box(0.028, 0.006, 0.006, 0.031, HC + 0.045, -0.0825, BROW), box(0.028, 0.006, 0.006, -0.031, HC + 0.045, -0.0825, BROW),
        box(0.036, 0.006, 0.006, 0, HC - 0.055, -0.0865, MOUTH),
        ellipsoid(0.083, HC - 0.004, 0.012, 0.009, 0.022, 0.016, 5, 3, SKIN_SHADE), ellipsoid(-0.083, HC - 0.004, 0.012, 0.009, 0.022, 0.016, 5, 3, SKIN_SHADE),
      );
    }
    return merge(parts);
  },
  neck: (c) => loft([{ y: -0.06, rx: 0.052, rz: 0.05 }, { y: 0.0, rx: 0.05, rz: 0.048 }, { y: 0.07, rx: 0.047, rz: 0.046 }], c.seg),
  hands: (c) => (c.lod === 0 ? ellipsoid(0, -R.forearm - 0.045, 0, 0.034, 0.058, 0.019, 6, 4) : box(0.06, 0.1, 0.036, 0, -R.forearm - 0.045, 0)),
  armSkinUpper: (c) => limb(UPPER_ARM, 1, c),
  armSkinFore: (c) => limb(FOREARM, 1, c),
  thighSkinLower: (c) => loft(profileRings(sliceProfile(THIGH, -R.thigh, -0.18), 1, c.lod), c.seg),
  thighSkinFull: (c) => limb(THIGH, 1, c),
  shinSkin: (c) => limb(SHIN, 1, c),

  torso: (c) => loft(c.lod === 0 ? TORSO_RINGS : [TORSO_RINGS[0]!, TORSO_RINGS[2]!, TORSO_RINGS[3]!, TORSO_RINGS[4]!, TORSO_RINGS[6]!], c.seg, { capTop: true }),
  apronPanel: (c) => merge([box(0.25, 0.74, 0.02, 0, 0.02, -0.128), ...(c.lod === 0 ? [box(0.035, 0.22, 0.012, 0, 0.44, -0.107)] : [])]),
  stripes: () => {
    const band = (y0: number, y1: number): THREE.BufferGeometry => {
      const [a, b] = [torsoRadiusAt(y0), torsoRadiusAt(y1)];
      return loft([{ y: y0, rx: a[0] * 1.03, rz: a[1] * 1.03 }, { y: y1, rx: b[0] * 1.03, rz: b[1] * 1.03 }], 8, { color: [0.88, 0.88, 0.8] });
    };
    return merge([band(0.1, 0.15), band(0.28, 0.33)]);
  },
  collar: (c) => loft([{ y: 0.5, rx: 0.084, rz: 0.076 }, { y: 0.54, rx: 0.08, rz: 0.072 }, { y: 0.575, rx: 0.068, rz: 0.064 }], c.seg),
  hood: () => ellipsoid(0, 0.555, 0.07, 0.1, 0.085, 0.07, 6, 4),
  hemJacket: (c) => loft([{ y: -0.17, rx: 0.178, rz: 0.128 }, { y: -0.02, rx: 0.17, rz: 0.12 }, { y: 0.06, rx: 0.163, rz: 0.113 }], c.seg),
  hemCoat: (c) => loft([{ y: -0.5, rx: 0.215, rz: 0.165 }, { y: -0.3, rx: 0.2, rz: 0.15 }, { y: -0.02, rx: 0.17, rz: 0.12 }, { y: 0.06, rx: 0.163, rz: 0.113 }], c.seg),
  sleeveShort: (c) => loft(profileRings(sliceProfile(UPPER_ARM, -0.14, 0.035), 1.14, c.lod), c.seg),
  sleeveLong: (c) => loft(profileRings(sliceProfile(UPPER_ARM, -R.upperArm + 0.005, 0.035), 1.14, c.lod), c.seg),
  foreSleeve: (c) => loft(profileRings(sliceProfile(FOREARM, -R.forearm + 0.02, 0.005), 1.14, c.lod), c.seg),

  // Le bord haut reste sous la coque du torse (qui descend à −0,07) pour ne pas dépasser sur les hanches.
  pelvis: (c) => loft([{ y: -0.13, rx: 0.145, rz: 0.1 }, { y: -0.05, rx: 0.158, rz: 0.108 }, { y: 0.02, rx: 0.155, rz: 0.106 }], c.seg, { capBottom: true }),
  skirt: (c) => loft([{ y: -0.4, rx: 0.235, rz: 0.19 }, { y: -0.25, rx: 0.215, rz: 0.17 }, { y: -0.02, rx: 0.17, rz: 0.12 }, { y: 0.08, rx: 0.163, rz: 0.113 }], c.seg),
  thighCloth: (c) => limb(THIGH, 1.12, c),
  shinCloth: (c) => loft(profileRings(sliceProfile(SHIN, -R.shin + 0.03, 0), 1.12, c.lod), c.seg),
  thighShorts: (c) => loft(profileRings(sliceProfile(THIGH, -0.19, 0.02), 1.12, c.lod), c.seg),

  foot: (c) => {
    const parts = [box(0.09, 0.07, 0.27, 0, -0.035, -0.055)];
    if (c.lod === 0) parts.push(ellipsoid(0, -0.04, -0.165, 0.046, 0.034, 0.062, 6, 4));
    return merge(parts);
  },
  sole: () => box(0.096, 0.016, 0.285, 0, -0.062, -0.055, [0.95, 0.93, 0.88]),
  bootShaft: (c) => loft([{ y: -0.4, rx: 0.052, rz: 0.052 }, { y: -0.28, rx: 0.056, rz: 0.056 }, { y: -0.16, rx: 0.058, rz: 0.058 }], c.seg),

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
    ...(c.lod === 0 ? [box(0.035, 0.28, 0.012, 0.09, 0.34, -0.117), box(0.035, 0.28, 0.012, -0.09, 0.34, -0.117)] : []),
  ]),
  shoulderBag: (c) => merge([
    box(0.28, 0.2, 0.09, -0.03, -0.02, 0.165),
    ...(c.lod === 0 ? [placed(box(0.035, 0.7, 0.012, 0, 0, 0), 0, 0.2, -0.122, 0, 0, -0.62)] : []),
  ]),
  handbag: (c) => merge([box(0.2, 0.15, 0.07, 0.01, -R.forearm - 0.13, 0), ...(c.lod === 0 ? [box(0.012, 0.1, 0.012, 0.01, -R.forearm - 0.045, 0)] : [])]),
  scarf: (c) => merge([
    loft([{ y: 0.49, rx: 0.088, rz: 0.082 }, { y: 0.52, rx: 0.1, rz: 0.092 }, { y: 0.555, rx: 0.09, rz: 0.084 }], c.seg),
    ...(c.lod === 0 ? [box(0.07, 0.24, 0.025, 0.03, 0.38, -0.12)] : []),
  ]),
};

/** Les anneaux de lunettes viennent de THREE.TorusGeometry : on les ramène au format commun. */
function finishTorus(g: THREE.BufferGeometry, color: RGB): THREE.BufferGeometry {
  const geo = g.toNonIndexed();
  g.dispose();
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(color, i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

const cache = new Map<string, THREE.BufferGeometry | null>();

/** Forme du catalogue au niveau de détail demandé (mise en cache), ou null si la pièce disparaît à ce niveau. */
export function shapeGeometry(shape: string, lod: Lod): THREE.BufferGeometry | null {
  const key = `${shape}/${lod}`;
  if (cache.has(key)) return cache.get(key)!;
  const build = SHAPES[shape];
  if (!build) throw new Error(`forme inconnue : ${shape}`);
  const g = build({ seg: lod === 0 ? 8 : 4, lod });
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
