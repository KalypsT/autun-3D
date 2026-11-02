import { applyAppearance, createRng, type HatKind, type Recipe, type TopKind } from "./character";

/**
 * Vêtements selon l'heure (J2-8, D46). La fraîcheur suit l'heure (nuit et petit matin frais, après-midi chaud), la saison et la pluie (D197). On retouche la recette tirée de la graine du passant plutôt que de la tirer autrement : sa morphologie, ses cheveux et ses
 * couleurs restent les mêmes à toute heure, seuls changent les couches (haut, bas, écharpe, bonnet, lunettes de soleil).
 */

/** Moyenne et amplitude (°C) de la journée selon la saison (D197) : printemps, été, automne, hiver en Bourgogne. */
const SEASON_AIR: readonly (readonly [number, number])[] = [[13, 6], [18, 8], [12, 5], [3, 4]];

/** Température de l'air (°C) à l'heure de jeu : l'été, 10 à 4 h, 26 à 16 h ; la pluie rafraîchit de 3 °C. Défaut : l'été, sec. */
export function airTemperature(hour: number, season = 1, rain = 0): number {
  const [mean, amp] = SEASON_AIR[season] ?? SEASON_AIR[1]!;
  return mean + amp * Math.sin(((hour - 10) / 24) * Math.PI * 2) - 3 * rain;
}

/** Fraîcheur 0 (chaud, tenues légères) à 1 (frais, couches et écharpes). */
export function coldAt(hour: number, season = 1, rain = 0): number {
  return Math.min(Math.max((22 - airTemperature(hour, season, rain)) / 12, 0), 1);
}

/** Part des passants qui sortent un parapluie sous une pluie d'intensité `rain` (D197). */
export function umbrellaShare(rain: number): number {
  return rain < 0.15 ? 0 : Math.min(0.75, 0.2 + 0.6 * rain);
}

const WARM_TOPS: readonly TopKind[] = ["tshirt", "sport"];
const LAYERED: readonly TopKind[] = ["jacket", "sweater", "coat", "hoodie"];

/** La recette habillée pour la fraîcheur `cold` (0 à 1) ; déterministe pour une graine ; les tenues de travail et de sport gardent leur tenue. */
export function dressForCold(recipe: Recipe, seed: number, cold: number): Recipe {
  if (recipe.outfit === "work") return recipe;
  const rng = createRng(seed ^ 0x5d1e55);
  const patch: Partial<Recipe> = {};
  const hot = cold < 0.2, chilly = cold > 0.55;
  const helmet: HatKind = "helmet";
  if (recipe.outfit === "city") {
    if (chilly && WARM_TOPS.includes(recipe.top) && rng() < 0.4 + 0.5 * cold) patch.top = rng() < 0.5 ? "jacket" : rng() < 0.6 ? "sweater" : "hoodie";
    else if (hot && LAYERED.includes(recipe.top) && rng() < 0.75) patch.top = rng() < 0.5 ? "tshirt" : "shirt";
    else if (hot && recipe.top === "sweater" && rng() < 0.5) patch.top = "tshirt";
    if (chilly && recipe.bottom === "shorts" && rng() < 0.85) patch.bottom = recipe.sex === "f" && rng() < 0.3 ? "skirt" : "jeans";
    else if (hot && (recipe.bottom === "jeans" || recipe.bottom === "trousers") && recipe.age === "adult" && rng() < 0.18) patch.bottom = "shorts";
  }
  if (chilly) {
    // Grand froid (l'hiver) : le manteau plutôt que la veste.
    if (cold > 0.9 && recipe.outfit === "city" && ["jacket", "sweater", "hoodie"].includes(patch.top ?? recipe.top) && rng() < 0.45) patch.top = "coat";
    if (recipe.hat === "none" && rng() < 0.18 * cold) patch.hat = "beanie";
    if (recipe.outfit === "city" && !recipe.scarf && rng() < 0.3 * cold) patch.scarf = true;
  } else if (hot) {
    if (recipe.hat === "beanie") patch.hat = "cap";
    if (recipe.scarf) patch.scarf = false;
    if (recipe.glasses === "none" && recipe.hat !== helmet && rng() < 0.22) patch.glasses = "sun";
  }
  return Object.keys(patch).length ? applyAppearance(recipe, patch) : recipe;
}
