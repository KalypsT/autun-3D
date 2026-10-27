/**
 * Apparence du joueur : sa recette de personnage (`character.ts`), enregistrée localement et séparément de la partie, comme les
 * réglages : « nouvelle partie » ne l'efface pas.
 */

import { applyAppearance, DEFAULT_RECIPE, parseRecipe, recipeFromSeed, serializeRecipe, type Recipe } from "./character";
import { browserStorage, type StorageLike } from "./save";

export const APPEARANCE_KEY = "autun3d.appearance";

/** Apparence tirée au hasard (cohérente) : n'importe quelle graine, tenue de ville ou de sport ou de travail. */
export function randomAppearance(random: () => number = Math.random): Recipe {
  return applyAppearance(recipeFromSeed(Math.floor(random() * 0x7fffffff)));
}

/** Apparence enregistrée : lecture et écriture sans exception (stockage absent, interdit ou plein). */
export class AppearanceStore {
  constructor(private readonly storage: StorageLike | null = browserStorage()) {}

  load(): Recipe {
    try {
      const text = this.storage?.getItem(APPEARANCE_KEY) ?? null;
      const recipe = parseRecipe(text, DEFAULT_RECIPE);
      return applyAppearance(recipe ?? DEFAULT_RECIPE);
    } catch {
      return { ...DEFAULT_RECIPE };
    }
  }

  write(recipe: Recipe): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(APPEARANCE_KEY, serializeRecipe(recipe));
      return true;
    } catch {
      return false;
    }
  }
}

/** Libellés français des choix de l'écran « Apparence ». */
export const LABELS = {
  sex: { f: "Femme", m: "Homme" },
  age: { adult: "Adulte", senior: "Senior" },
  build: { slim: "Mince", average: "Moyenne", stocky: "Forte", heavy: "Corpulente" },
  hairStyle: { bald: "Chauve", buzz: "Rasée", short: "Courte", side: "Raie", curly: "Bouclée", bob: "Carré", long: "Longue", ponytail: "Queue de cheval", bun: "Chignon" },
  top: { tshirt: "T-shirt", shirt: "Chemise", sweater: "Pull", jacket: "Veste", coat: "Manteau", hoodie: "Sweat à capuche", sport: "Haut de sport", hivis: "Gilet de chantier", apron: "Tablier" },
  bottom: { jeans: "Jean", trousers: "Pantalon", shorts: "Short", skirt: "Jupe", jogging: "Jogging", work: "Pantalon de travail" },
  shoes: { sneakers: "Baskets", leather: "Chaussures de ville", boots: "Bottes" },
  hat: { none: "Aucun", cap: "Casquette", beanie: "Bonnet", hat: "Chapeau", beret: "Béret", helmet: "Casque de chantier" },
  glasses: { none: "Aucunes", glasses: "Lunettes", sun: "Solaires" },
  bag: { none: "Aucun", backpack: "Sac à dos", shoulder: "Besace", handbag: "Sac à main" },
  beard: { none: "Aucune", stubble: "Barbe de 3 jours", mustache: "Moustache", beard: "Barbe" },
} as const;
