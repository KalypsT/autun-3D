/**
 * Recette de personnage (D36) : tout ce qui distingue un passant d'un autre, tiré d'une graine, et les mesures du corps
 * qui en découlent. Logique pure : le rendu (`src/render`) ne fait que lire une recette. Le joueur utilise la même.
 *
 * Analogie : la recette est un jeu de fiches de cuisine. Quelques ingrédients (coiffures, hauts, couleurs…) combinés au hasard
 * donnent des milliers de plats, sans qu'aucun ne coûte plus cher à préparer qu'un autre.
 */

export const RECIPE_VERSION = 1;

export const SEXES = ["f", "m"] as const;
export const AGES = ["adult", "senior"] as const;
export const BUILDS = ["slim", "average", "stocky", "heavy"] as const;
export const HAIR_STYLES = ["bald", "buzz", "short", "side", "curly", "bob", "long", "ponytail", "bun"] as const;
export const TOPS = ["tshirt", "shirt", "sweater", "jacket", "coat", "hoodie", "sport", "hivis", "apron"] as const;
export const BOTTOMS = ["jeans", "trousers", "shorts", "skirt", "jogging", "work"] as const;
export const SHOES = ["sneakers", "leather", "boots"] as const;
export const HATS = ["none", "cap", "beanie", "hat", "beret", "helmet"] as const;
export const GLASSES = ["none", "glasses", "sun"] as const;
export const BAGS = ["none", "backpack", "shoulder", "handbag"] as const;
export const BEARDS = ["none", "stubble", "mustache", "beard"] as const;
export const OUTFITS = ["city", "sport", "work"] as const;

export type Sex = (typeof SEXES)[number];
export type Age = (typeof AGES)[number];
export type Build = (typeof BUILDS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopKind = (typeof TOPS)[number];
export type BottomKind = (typeof BOTTOMS)[number];
export type ShoeKind = (typeof SHOES)[number];
export type HatKind = (typeof HATS)[number];
export type GlassesKind = (typeof GLASSES)[number];
export type BagKind = (typeof BAGS)[number];
export type BeardKind = (typeof BEARDS)[number];
export type Outfit = (typeof OUTFITS)[number];

/** Palettes de l'affiche : les recettes ne stockent que des indices (compacts, validables). */
export const SKIN_TONES = ["#f3cfb3", "#eeb98f", "#d9a074", "#b9774c", "#8a5232", "#5e3a24"] as const;
export const HAIR_COLORS = ["#1e1a18", "#3a281d", "#5b3a24", "#7a4e2d", "#c9a45c", "#e0c88a", "#a8472a", "#9a9a9a", "#e6e3dc", "#2a6f7e"] as const;
/** Hauts, chapeaux, sacs, écharpes. Les deux derniers sont les couleurs fluo des gilets de chantier. */
export const CLOTH_COLORS = [
  "#d9472b", "#1f3a52", "#f1b24a", "#efe3c8", "#2a6f7e", "#3f7d4e", "#7a5232", "#8a8f98", "#2b2b30",
  "#f4efe4", "#e0a0a0", "#7b2a35", "#7fb0d0", "#6f7040", "#e0762e", "#6a4c8c", "#e8e03a", "#ff7a1a",
] as const;
export const BOTTOM_COLORS = ["#3d5a80", "#26364f", "#232329", "#1f3a52", "#6b6f78", "#cdb892", "#6f7040", "#5a3d28", "#e8e0cc", "#6b2430", "#2f5238"] as const;
export const SHOE_COLORS = ["#efe9dc", "#222226", "#5a3b26", "#1f3a52", "#c03a2a", "#8a8a90", "#c8b18a"] as const;

/** Indices dans `CLOTH_COLORS` réservés au travail. */
const HIVIS_COLORS = [16, 17] as const;
const WHITE = 9;
const YELLOW_HIVIS = 16;

export const HEIGHT_RANGE = { min: 1.45, max: 2.02 } as const;

export interface Recipe {
  sex: Sex;
  age: Age;
  /** Taille (m). */
  height: number;
  build: Build;
  skin: number;
  hairStyle: HairStyle;
  hairColor: number;
  top: TopKind;
  topColor: number;
  bottom: BottomKind;
  bottomColor: number;
  shoes: ShoeKind;
  shoeColor: number;
  hat: HatKind;
  hatColor: number;
  glasses: GlassesKind;
  bag: BagKind;
  bagColor: number;
  scarf: boolean;
  scarfColor: number;
  beard: BeardKind;
  /** Famille de tenue : sert à la cohérence du tirage et à l'affichage, pas au rendu. */
  outfit: Outfit;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hasard déterministe

/** Générateur à graine (mulberry32) : même graine, même suite. */
export function createRng(seed: number): () => number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
type Weighted<T> = readonly (readonly [T, number])[];

function pick<T>(rng: Rng, items: Weighted<T>): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r < 0) return v;
  }
  return items[items.length - 1]![0];
}

const chance = (rng: Rng, p: number): boolean => rng() < p;

/** Loi normale tronquée à ±`limit` écarts-types (Box-Muller). */
function normal(rng: Rng, mean: number, sd: number, limit = 2.4): number {
  const u = Math.max(rng(), 1e-9), v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + Math.min(Math.max(z, -limit), limit) * sd;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tirage

const SENIOR_SHARE = 0.28;
const FEMALE_SHARE = 0.52;

/** Poids des couleurs de haut : les teintes sobres dominent, le vermillon et la moutarde de l'affiche restent fréquents. */
const TOP_COLOR_WEIGHTS: Weighted<number> = [
  [0, 8], [1, 12], [2, 6], [3, 8], [4, 8], [5, 6], [6, 4], [7, 9], [8, 10], [9, 10], [10, 4], [11, 4], [12, 5], [13, 4], [14, 3], [15, 2],
];
const BOTTOM_COLOR_CHOICES: Record<BottomKind, Weighted<number>> = {
  jeans: [[0, 50], [1, 36], [2, 14]],
  trousers: [[2, 20], [3, 16], [4, 16], [5, 16], [6, 10], [7, 12], [10, 4], [9, 3], [8, 3]],
  shorts: [[0, 24], [5, 26], [6, 14], [3, 14], [8, 14], [2, 8]],
  skirt: [[2, 24], [3, 18], [9, 10], [10, 8], [0, 14], [4, 12], [7, 8], [5, 6]],
  jogging: [[2, 36], [4, 28], [3, 20], [1, 16]],
  work: [[3, 40], [2, 20], [6, 20], [4, 20]],
};
const SHOE_COLOR_CHOICES: Record<ShoeKind, Weighted<number>> = {
  sneakers: [[0, 38], [1, 26], [5, 14], [3, 12], [4, 10]],
  leather: [[1, 50], [2, 36], [6, 14]],
  boots: [[2, 44], [1, 36], [6, 20]],
};

function pickBuild(rng: Rng, age: Age, outfit: Outfit): Build {
  if (outfit === "sport") return pick(rng, [["slim", 32], ["average", 50], ["stocky", 14], ["heavy", 4]] as const);
  if (age === "senior") return pick(rng, [["slim", 14], ["average", 42], ["stocky", 28], ["heavy", 16]] as const);
  return pick(rng, [["slim", 22], ["average", 46], ["stocky", 22], ["heavy", 10]] as const);
}

function pickHair(rng: Rng, sex: Sex, age: Age): HairStyle {
  if (sex === "m") {
    return age === "senior"
      ? pick(rng, [["bald", 30], ["buzz", 12], ["short", 38], ["side", 16], ["curly", 4]] as const)
      : pick(rng, [["bald", 4], ["buzz", 12], ["short", 40], ["side", 18], ["curly", 10], ["long", 4], ["ponytail", 2], ["bun", 1]] as const);
  }
  return age === "senior"
    ? pick(rng, [["short", 38], ["bob", 24], ["bun", 14], ["curly", 14], ["long", 6], ["ponytail", 2], ["side", 2]] as const)
    : pick(rng, [["short", 12], ["side", 5], ["bob", 18], ["long", 30], ["ponytail", 16], ["bun", 8], ["curly", 10], ["buzz", 1]] as const);
}

function pickHairColor(rng: Rng, age: Age): number {
  const adult: Weighted<number> = [[0, 22], [1, 26], [2, 20], [3, 12], [4, 8], [5, 3], [6, 4], [7, 3], [8, 1], [9, 1]];
  const senior: Weighted<number> = [[7, 40], [8, 28], [1, 8], [2, 6], [0, 4], [3, 3], [4, 3]];
  return pick(rng, age === "senior" ? senior : adult);
}

/** Recette complète tirée d'une graine : même graine, même personnage, sur tous les appareils. */
export function recipeFromSeed(seed: number): Recipe {
  const rng = createRng(seed);
  const sex: Sex = chance(rng, FEMALE_SHARE) ? "f" : "m";
  const age: Age = chance(rng, SENIOR_SHARE) ? "senior" : "adult";
  const outfit: Outfit = pick(
    rng,
    age === "senior" ? ([["city", 92], ["sport", 5], ["work", 3]] as const) : ([["city", 70], ["sport", 15], ["work", 15]] as const),
  );
  const build = pickBuild(rng, age, outfit);
  const mean = (sex === "m" ? 1.78 : 1.65) - (age === "senior" ? 0.03 : 0);
  const height = Math.round(Math.min(Math.max(normal(rng, mean, sex === "m" ? 0.07 : 0.065), HEIGHT_RANGE.min), HEIGHT_RANGE.max) * 100) / 100;
  const skin = pick(rng, [[0, 22], [1, 42], [2, 18], [3, 8], [4, 6], [5, 4]] as const);
  const hairStyle = pickHair(rng, sex, age);
  const hairColor = pickHairColor(rng, age);

  // Tenue : haut, bas, chaussures, selon la famille.
  let top: TopKind, bottom: BottomKind, shoes: ShoeKind;
  let topColor: number;
  if (outfit === "work") {
    top = chance(rng, 0.55) ? "hivis" : "apron";
    topColor = top === "hivis" ? pick(rng, [[YELLOW_HIVIS, 55], [17, 45]] as const) : pick(rng, TOP_COLOR_WEIGHTS);
    bottom = top === "hivis" ? "work" : pick(rng, sex === "f" ? ([["trousers", 50], ["jeans", 30], ["skirt", 20]] as const) : ([["trousers", 60], ["jeans", 40]] as const));
    shoes = top === "hivis" ? "boots" : pick(rng, [["leather", 50], ["sneakers", 50]] as const);
  } else if (outfit === "sport") {
    top = pick(rng, [["sport", 70], ["hoodie", 20], ["tshirt", 10]] as const);
    topColor = pick(rng, TOP_COLOR_WEIGHTS);
    bottom = pick(rng, [["jogging", 55], ["shorts", 45]] as const);
    shoes = "sneakers";
  } else {
    top = pick(
      rng,
      age === "senior"
        ? ([["tshirt", 10], ["shirt", 22], ["sweater", 28], ["jacket", 20], ["coat", 16], ["hoodie", 4]] as const)
        : sex === "m"
          ? ([["tshirt", 28], ["shirt", 18], ["sweater", 16], ["jacket", 16], ["coat", 8], ["hoodie", 14]] as const)
          : ([["tshirt", 22], ["shirt", 14], ["sweater", 20], ["jacket", 14], ["coat", 12], ["hoodie", 10]] as const),
    );
    topColor = pick(rng, TOP_COLOR_WEIGHTS);
    bottom = pick(
      rng,
      sex === "m"
        ? age === "senior"
          ? ([["trousers", 56], ["jeans", 36], ["shorts", 4], ["jogging", 4]] as const)
          : ([["jeans", 42], ["trousers", 36], ["shorts", 12], ["jogging", 10]] as const)
        : age === "senior"
          ? ([["trousers", 40], ["skirt", 32], ["jeans", 24], ["jogging", 4]] as const)
          : ([["jeans", 34], ["trousers", 22], ["skirt", 28], ["shorts", 10], ["jogging", 6]] as const),
    );
    shoes = pick(rng, sex === "f" ? ([["sneakers", 50], ["leather", 28], ["boots", 22]] as const) : ([["sneakers", 55], ["leather", 30], ["boots", 15]] as const));
  }
  const bottomColor = pick(rng, BOTTOM_COLOR_CHOICES[bottom]);
  const shoeColor = pick(rng, SHOE_COLOR_CHOICES[shoes]);

  // Accessoires.
  let hat: HatKind = "none";
  if (outfit === "work" && top === "hivis") hat = chance(rng, 0.5) ? "helmet" : "none";
  else if (outfit === "sport") hat = chance(rng, 0.25) ? pick(rng, [["cap", 70], ["beanie", 30]] as const) : "none";
  else if (outfit === "city" && chance(rng, age === "senior" ? 0.2 : 0.12)) {
    hat = pick(rng, age === "senior" && sex === "m" ? ([["beret", 45], ["hat", 25], ["cap", 25], ["beanie", 5]] as const) : ([["cap", 35], ["beanie", 28], ["hat", 22], ["beret", 15]] as const));
  }
  const hatColor = hat === "helmet" ? (chance(rng, 0.7) ? YELLOW_HIVIS : WHITE) : pick(rng, TOP_COLOR_WEIGHTS);
  const glasses: GlassesKind = pick(rng, age === "senior" ? ([["none", 54], ["glasses", 38], ["sun", 8]] as const) : ([["none", 76], ["glasses", 14], ["sun", 10]] as const));
  const bagChance = outfit === "city" ? 0.4 : outfit === "sport" ? 0.2 : 0.1;
  const bag: BagKind = chance(rng, bagChance)
    ? pick(rng, sex === "f" ? ([["backpack", 30], ["shoulder", 30], ["handbag", 40]] as const) : ([["backpack", 55], ["shoulder", 45]] as const))
    : "none";
  const bagColor = pick(rng, TOP_COLOR_WEIGHTS);
  const scarf = outfit === "city" && chance(rng, age === "senior" ? 0.18 : 0.1);
  const scarfColor = pick(rng, TOP_COLOR_WEIGHTS);
  const beard: BeardKind =
    sex === "f" ? "none" : pick(rng, age === "senior" ? ([["none", 55], ["stubble", 8], ["mustache", 17], ["beard", 20]] as const) : ([["none", 62], ["stubble", 14], ["mustache", 6], ["beard", 18]] as const));

  return { sex, age, height, build, skin, hairStyle, hairColor, top, topColor, bottom, bottomColor, shoes, shoeColor, hat, hatColor, glasses, bag, bagColor, scarf, scarfColor, beard, outfit };
}

/** Recette du joueur avant tout choix : celle de l'affiche (veste vermillon, pantalon bleu nuit, bonnet bleu-vert). */
export const DEFAULT_RECIPE: Recipe = {
  sex: "m", age: "adult", height: 1.78, build: "average", skin: 1, hairStyle: "short", hairColor: 1,
  top: "jacket", topColor: 0, bottom: "trousers", bottomColor: 3, shoes: "sneakers", shoeColor: 1,
  hat: "beanie", hatColor: 4, glasses: "none", bag: "none", bagColor: 8, scarf: true, scarfColor: 2, beard: "none", outfit: "city",
};

// ---------------------------------------------------------------------------------------------------------------------
// Sérialisation défensive

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function index(max: number, v: unknown, fallback: number): number {
  return finite(v) && Number.isInteger(v) && v >= 0 && v < max ? v : fallback;
}

export function serializeRecipe(r: Recipe): string {
  return JSON.stringify({ version: RECIPE_VERSION, ...r });
}

/**
 * Recette lue d'un JSON quelconque : chaque champ invalide retombe sur celui de `fallback`, la taille est bornée.
 * Renvoie null seulement si le texte n'est pas un objet JSON ou d'une version inconnue (plus récente que ce jeu).
 */
export function parseRecipe(text: string | null, fallback: Recipe = DEFAULT_RECIPE): Recipe | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== "object" || !o || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r["version"] !== RECIPE_VERSION) return null;
  const f = fallback;
  const height = finite(r["height"]) ? Math.round(Math.min(Math.max(r["height"], HEIGHT_RANGE.min), HEIGHT_RANGE.max) * 100) / 100 : f.height;
  return {
    sex: oneOf(SEXES, r["sex"], f.sex),
    age: oneOf(AGES, r["age"], f.age),
    height,
    build: oneOf(BUILDS, r["build"], f.build),
    skin: index(SKIN_TONES.length, r["skin"], f.skin),
    hairStyle: oneOf(HAIR_STYLES, r["hairStyle"], f.hairStyle),
    hairColor: index(HAIR_COLORS.length, r["hairColor"], f.hairColor),
    top: oneOf(TOPS, r["top"], f.top),
    topColor: index(CLOTH_COLORS.length, r["topColor"], f.topColor),
    bottom: oneOf(BOTTOMS, r["bottom"], f.bottom),
    bottomColor: index(BOTTOM_COLORS.length, r["bottomColor"], f.bottomColor),
    shoes: oneOf(SHOES, r["shoes"], f.shoes),
    shoeColor: index(SHOE_COLORS.length, r["shoeColor"], f.shoeColor),
    hat: oneOf(HATS, r["hat"], f.hat),
    hatColor: index(CLOTH_COLORS.length, r["hatColor"], f.hatColor),
    glasses: oneOf(GLASSES, r["glasses"], f.glasses),
    bag: oneOf(BAGS, r["bag"], f.bag),
    bagColor: index(CLOTH_COLORS.length, r["bagColor"], f.bagColor),
    scarf: typeof r["scarf"] === "boolean" ? r["scarf"] : f.scarf,
    scarfColor: index(CLOTH_COLORS.length, r["scarfColor"], f.scarfColor),
    beard: oneOf(BEARDS, r["beard"], f.beard),
    outfit: oneOf(OUTFITS, r["outfit"], f.outfit),
  };
}

/** Une recette est-elle dans les bornes ? (tests, et garde-fou pour les recettes construites à la main). */
export function isValidRecipe(r: Recipe): boolean {
  const inList = (list: readonly string[], v: string): boolean => list.includes(v);
  const idx = (max: number, v: number): boolean => Number.isInteger(v) && v >= 0 && v < max;
  return (
    inList(SEXES, r.sex) && inList(AGES, r.age) && finite(r.height) && r.height >= HEIGHT_RANGE.min && r.height <= HEIGHT_RANGE.max &&
    inList(BUILDS, r.build) && idx(SKIN_TONES.length, r.skin) && inList(HAIR_STYLES, r.hairStyle) && idx(HAIR_COLORS.length, r.hairColor) &&
    inList(TOPS, r.top) && idx(CLOTH_COLORS.length, r.topColor) && inList(BOTTOMS, r.bottom) && idx(BOTTOM_COLORS.length, r.bottomColor) &&
    inList(SHOES, r.shoes) && idx(SHOE_COLORS.length, r.shoeColor) && inList(HATS, r.hat) && idx(CLOTH_COLORS.length, r.hatColor) &&
    inList(GLASSES, r.glasses) && inList(BAGS, r.bag) && idx(CLOTH_COLORS.length, r.bagColor) && typeof r.scarf === "boolean" &&
    idx(CLOTH_COLORS.length, r.scarfColor) && inList(BEARDS, r.beard) && inList(OUTFITS, r.outfit)
  );
}

/** Couleurs résolues (chaînes CSS) : ce que le rendu applique. */
export interface RecipeColors {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  hat: string;
  bag: string;
  scarf: string;
}

export function recipeColors(r: Recipe): RecipeColors {
  return {
    skin: SKIN_TONES[r.skin]!, hair: HAIR_COLORS[r.hairColor]!, top: CLOTH_COLORS[r.topColor]!, bottom: BOTTOM_COLORS[r.bottomColor]!,
    shoes: SHOE_COLORS[r.shoeColor]!, hat: CLOTH_COLORS[r.hatColor]!, bag: CLOTH_COLORS[r.bagColor]!, scarf: CLOTH_COLORS[r.scarfColor]!,
  };
}

/** Un haut est-il fluo ? (les couleurs fluo sont réservées au gilet de chantier). */
export const isHivisColor = (cloth: number): boolean => (HIVIS_COLORS as readonly number[]).includes(cloth);

// ---------------------------------------------------------------------------------------------------------------------
// Mesures du corps

/** Proportions d'adulte (fractions de la taille, d'après les tables anthropométriques usuelles), en mètres une fois multipliées. */
export interface BodyDims {
  height: number;
  /** Hauteurs au-dessus du sol (m). */
  ankleY: number;
  kneeY: number;
  hipY: number;
  shoulderY: number;
  neckY: number;
  headCenterY: number;
  /** Longueurs des segments (m). */
  thigh: number;
  shin: number;
  torso: number;
  upperArm: number;
  forearm: number;
  hand: number;
  /** Demi-largeurs et profondeurs (m), corpulence comprise. */
  shoulderHalf: number;
  hipHalf: number;
  waistHalf: number;
  torsoDepth: number;
  limbRadius: number;
  headRadius: number;
  /** Inclinaison du buste vers l'avant au repos (rad) : 0 pour un adulte, un peu voûté pour un senior. */
  stoop: number;
  /** Écart des pieds au repos : demi-largeur du bassin. */
  stance: number;
}

const BUILD_WIDTH: Record<Build, number> = { slim: 0.88, average: 1, stocky: 1.14, heavy: 1.32 };
/** Le ventre ne grandit pas comme les épaules : il pèse plus sur la profondeur. */
const BUILD_DEPTH: Record<Build, number> = { slim: 0.88, average: 1, stocky: 1.2, heavy: 1.5 };

export function bodyDims(r: Recipe): BodyDims {
  const H = r.height;
  const w = BUILD_WIDTH[r.build], d = BUILD_DEPTH[r.build];
  const female = r.sex === "f";
  const hipY = 0.52 * H, shoulderY = 0.82 * H;
  const shoulderHalf = (female ? 0.108 : 0.123) * H * (0.9 + 0.1 * w);
  const hipHalf = (female ? 0.1 : 0.088) * H * w;
  return {
    height: H,
    ankleY: 0.04 * H,
    kneeY: 0.285 * H,
    hipY,
    shoulderY,
    neckY: 0.865 * H,
    headCenterY: 0.935 * H,
    thigh: hipY - 0.285 * H,
    shin: 0.285 * H - 0.04 * H,
    torso: shoulderY - hipY,
    upperArm: 0.186 * H,
    forearm: 0.146 * H,
    hand: 0.1 * H,
    shoulderHalf,
    hipHalf,
    waistHalf: (female ? 0.082 : 0.09) * H * w,
    torsoDepth: 0.07 * H * d,
    limbRadius: 0.032 * H * (0.8 + 0.2 * w),
    headRadius: 0.066 * H * (female ? 0.97 : 1),
    stoop: r.age === "senior" ? 0.1 : 0.02,
    stance: hipHalf * 0.8,
  };
}
