/**
 * Catalogue des pièces d'un personnage (D37) : quelles pièces pour quelle recette. Logique pure ; les formes sont dans
 * `src/render/character-parts.ts`. Une pièce est fixée à un ou deux os (les deux côtés partagent la même forme), prend la couleur
 * d'un « emplacement » de la recette (peau, cheveux, haut…), et n'existe que pour les recettes qui la demandent.
 *
 * Analogie : une penderie. Chaque recette choisit ses habits dans la même penderie ; trois façons de s'habiller (peau,
 * instances, pièces groupées) donnent le même résultat, seul le temps de préparation change.
 */

import type { Recipe, TopKind } from "./character";
import { BONE } from "./character-rig";

/** Emplacements de couleur : le rendu les remplace par la couleur de la recette. −1 : couleur de la forme telle quelle. */
export const SLOT = { none: -1, skin: 0, hair: 1, top: 2, bottom: 3, shoes: 4, hat: 5, bag: 6, scarf: 7 } as const;
export const SLOT_COUNT = 8;

export interface PartSpec {
  id: string;
  /** Nom de la forme dans le catalogue de rendu (plusieurs pièces peuvent partager une forme dans des couleurs différentes). */
  shape: string;
  /** Os qui portent la pièce ; la forme est dessinée une fois dans le repère de l'os, et copiée pour chacun. */
  bones: readonly number[];
  slot: number;
  when(r: Recipe): boolean;
  /** Gardée au loin (niveau de détail 1) ; les petits détails sont écartés. */
  far: boolean;
}

const SHORT_SLEEVES: readonly TopKind[] = ["tshirt", "sport"];
const isShort = (r: Recipe): boolean => SHORT_SLEEVES.includes(r.top);
const LONG_TROUSERS = ["jeans", "trousers", "jogging", "work"] as const;
const longLegs = (r: Recipe): boolean => (LONG_TROUSERS as readonly string[]).includes(r.bottom);
const COLLARED: readonly TopKind[] = ["shirt", "jacket", "coat", "sweater", "hoodie"];

const both = (l: number, r: number): readonly number[] => [l, r];
const ARMS = both(BONE.armL, BONE.armR);
const FOREARMS = both(BONE.forearmL, BONE.forearmR);
const THIGHS = both(BONE.thighL, BONE.thighR);
const SHINS = both(BONE.shinL, BONE.shinR);
const FEET = both(BONE.footL, BONE.footR);
const HEAD = [BONE.head];
const TORSO = [BONE.torso];
const PELVIS = [BONE.pelvis];

const spec = (id: string, bones: readonly number[], slot: number, far: boolean, when: (r: Recipe) => boolean, shape = id): PartSpec => ({ id, shape, bones, slot, far, when });
const always = (): boolean => true;

export const PART_SPECS: readonly PartSpec[] = [
  // Corps et peau.
  spec("head", HEAD, SLOT.skin, true, always),
  spec("neck", HEAD, SLOT.skin, true, always),
  spec("hands", FOREARMS, SLOT.skin, true, always),
  spec("armSkinUpper", ARMS, SLOT.skin, true, isShort),
  spec("armSkinFore", FOREARMS, SLOT.skin, true, isShort),
  spec("thighSkinLower", THIGHS, SLOT.skin, true, (r) => r.bottom === "shorts"),
  spec("thighSkinFull", THIGHS, SLOT.skin, true, (r) => r.bottom === "skirt"),
  spec("shinSkin", SHINS, SLOT.skin, true, (r) => r.bottom === "shorts" || r.bottom === "skirt"),
  // Haut : une seule coque de torse (le tablier recouvre une chemise dans l'emplacement « écharpe »).
  spec("torsoTop", TORSO, SLOT.top, true, (r) => r.top !== "apron", "torso"),
  spec("torsoApron", TORSO, SLOT.scarf, true, (r) => r.top === "apron", "torso"),
  spec("apronPanel", TORSO, SLOT.top, false, (r) => r.top === "apron"),
  spec("stripes", TORSO, SLOT.none, false, (r) => r.top === "hivis"),
  spec("collar", TORSO, SLOT.top, false, (r) => COLLARED.includes(r.top)),
  spec("hood", TORSO, SLOT.top, false, (r) => r.top === "hoodie"),
  spec("hemJacket", PELVIS, SLOT.top, false, (r) => r.top === "jacket" || r.top === "hoodie"),
  spec("hemCoat", PELVIS, SLOT.top, true, (r) => r.top === "coat"),
  spec("sleeveShort", ARMS, SLOT.top, true, isShort),
  spec("sleeveLongTop", ARMS, SLOT.top, true, (r) => !isShort(r) && r.top !== "apron" && r.top !== "hivis", "sleeveLong"),
  spec("sleeveLongApron", ARMS, SLOT.scarf, true, (r) => r.top === "apron", "sleeveLong"),
  spec("sleeveLongWork", ARMS, SLOT.bottom, true, (r) => r.top === "hivis", "sleeveLong"),
  spec("foreSleeveTop", FOREARMS, SLOT.top, true, (r) => !isShort(r) && r.top !== "apron" && r.top !== "hivis", "foreSleeve"),
  spec("foreSleeveApron", FOREARMS, SLOT.scarf, true, (r) => r.top === "apron", "foreSleeve"),
  spec("foreSleeveWork", FOREARMS, SLOT.bottom, true, (r) => r.top === "hivis", "foreSleeve"),
  // Bas.
  spec("pelvis", PELVIS, SLOT.bottom, true, (r) => r.bottom !== "skirt"),
  spec("skirt", PELVIS, SLOT.bottom, true, (r) => r.bottom === "skirt"),
  spec("thighCloth", THIGHS, SLOT.bottom, true, longLegs),
  spec("shinCloth", SHINS, SLOT.bottom, true, longLegs),
  spec("thighShorts", THIGHS, SLOT.bottom, true, (r) => r.bottom === "shorts"),
  // Chaussures.
  spec("foot", FEET, SLOT.shoes, true, always),
  spec("sole", FEET, SLOT.none, false, (r) => r.shoes === "sneakers"),
  spec("bootShaft", SHINS, SLOT.shoes, true, (r) => r.shoes === "boots"),
  // Cheveux.
  spec("hairBuzz", HEAD, SLOT.hair, true, (r) => r.hairStyle === "buzz"),
  spec("hairShort", HEAD, SLOT.hair, true, (r) => r.hairStyle === "short"),
  spec("hairSide", HEAD, SLOT.hair, true, (r) => r.hairStyle === "side"),
  spec("hairCurly", HEAD, SLOT.hair, true, (r) => r.hairStyle === "curly"),
  spec("hairBob", HEAD, SLOT.hair, true, (r) => r.hairStyle === "bob"),
  spec("hairLong", HEAD, SLOT.hair, true, (r) => r.hairStyle === "long"),
  spec("hairPonytail", HEAD, SLOT.hair, true, (r) => r.hairStyle === "ponytail"),
  spec("hairBun", HEAD, SLOT.hair, true, (r) => r.hairStyle === "bun"),
  // Chapeaux, lunettes, barbe.
  spec("hatCap", HEAD, SLOT.hat, true, (r) => r.hat === "cap"),
  spec("hatBeanie", HEAD, SLOT.hat, true, (r) => r.hat === "beanie"),
  spec("hatFedora", HEAD, SLOT.hat, true, (r) => r.hat === "hat"),
  spec("hatBeret", HEAD, SLOT.hat, true, (r) => r.hat === "beret"),
  spec("hatHelmet", HEAD, SLOT.hat, true, (r) => r.hat === "helmet"),
  spec("glassesClear", HEAD, SLOT.none, false, (r) => r.glasses === "glasses"),
  spec("glassesSun", HEAD, SLOT.none, false, (r) => r.glasses === "sun"),
  spec("stubble", HEAD, SLOT.skin, false, (r) => r.beard === "stubble"),
  spec("mustache", HEAD, SLOT.hair, false, (r) => r.beard === "mustache"),
  spec("beard", HEAD, SLOT.hair, false, (r) => r.beard === "beard"),
  // Sacs et écharpe.
  spec("backpack", TORSO, SLOT.bag, true, (r) => r.bag === "backpack"),
  spec("shoulderBag", TORSO, SLOT.bag, false, (r) => r.bag === "shoulder"),
  spec("handbag", [BONE.forearmR], SLOT.bag, false, (r) => r.bag === "handbag"),
  spec("scarf", TORSO, SLOT.scarf, false, (r) => r.scarf),
];

/** Les mises à jour de masque tiennent sur trois nombres de 22 bits : au plus 66 pièces. */
export const MAX_PARTS = 66;

/** Pièces présentes pour une recette (une case par pièce du catalogue). */
export function visibleParts(r: Recipe, out: boolean[] = new Array<boolean>(PART_SPECS.length)): boolean[] {
  for (let i = 0; i < PART_SPECS.length; i++) out[i] = PART_SPECS[i]!.when(r);
  return out;
}

/** Masque de pièces en trois mots de 22 bits (exacts en flottant 32 bits), pour un nuanceur. */
export function partMask(r: Recipe, out: Float32Array | number[] = [0, 0, 0]): Float32Array | number[] {
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < PART_SPECS.length; i++) if (PART_SPECS[i]!.when(r)) out[Math.floor(i / 22)] = (out[Math.floor(i / 22)] as number) + 2 ** (i % 22);
  return out;
}

/** Nombre de pièces visibles (et d'instances de pièces avec les doublons de côté). */
export function countParts(r: Recipe): { parts: number; pieces: number } {
  let parts = 0, pieces = 0;
  for (const s of PART_SPECS) if (s.when(r)) { parts++; pieces += s.bones.length; }
  return { parts, pieces };
}
