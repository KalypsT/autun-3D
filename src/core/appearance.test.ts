import { describe, expect, it } from "vitest";
import {
  AGES, applyAppearance, BAGS, BEARDS, bottomColorChoices, BOTTOMS, BUILDS, CLOTH_COLORS, DEFAULT_RECIPE, GLASSES, HAIR_STYLES, HATS, hatColorChoices, isHivisColor, isValidRecipe,
  recipeFromSeed, SEXES, SHOES, shoeColorChoices, TOPS, topColorChoices,
} from "./character";
import { AppearanceStore, APPEARANCE_KEY, LABELS, randomAppearance } from "./appearance";
import type { StorageLike } from "./save";

class Memory implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

describe("cohérence d'une recette modifiée à la main", () => {
  it("laisse intacte une recette tirée (et l'opération est idempotente)", () => {
    const bad: number[] = [];
    for (let s = 1; s <= 400; s++) {
      const r = recipeFromSeed(s);
      const a = applyAppearance(r);
      if (JSON.stringify(applyAppearance(a)) !== JSON.stringify(a)) bad.push(s);
      if (!isValidRecipe(a)) bad.push(-s);
    }
    expect(bad).toEqual([]);
  });

  it("garde une recette valide et cohérente quelle que soit la combinaison de choix (une seule vérification groupée)", () => {
    const bad: string[] = [];
    let n = 0;
    for (const top of TOPS) {
      for (const bottom of BOTTOMS) {
        for (const shoes of SHOES) {
          for (const hat of HATS) {
            // Valeurs de couleur volontairement hors palette de la pièce.
            const r = applyAppearance(DEFAULT_RECIPE, { top, bottom, shoes, hat, topColor: 17, bottomColor: 10, shoeColor: 6, hatColor: 17, bagColor: 17, scarfColor: 16, scarf: true });
            n++;
            if (!isValidRecipe(r)) bad.push(`${top} ${bottom} ${shoes} ${hat}: invalide`);
            if (!topColorChoices(r.top).includes(r.topColor)) bad.push(`${top}: couleur de haut`);
            if (!hatColorChoices(r.hat).includes(r.hatColor)) bad.push(`${hat}: couleur de chapeau`);
            if (!bottomColorChoices(r.bottom).includes(r.bottomColor)) bad.push(`${bottom}: couleur de bas`);
            if (!shoeColorChoices(r.shoes).includes(r.shoeColor)) bad.push(`${shoes}: couleur de chaussures`);
            if (isHivisColor(r.topColor) !== (r.top === "hivis")) bad.push(`${top}: fluo`);
            if (isHivisColor(r.bagColor) || isHivisColor(r.scarfColor)) bad.push("fluo hors gilet");
            if (r.top === "apron" && r.scarf) bad.push("écharpe sous tablier");
          }
        }
      }
    }
    expect(n).toBe(TOPS.length * BOTTOMS.length * SHOES.length * HATS.length);
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it("borne la taille et déduit la famille de tenue du haut", () => {
    expect(applyAppearance(DEFAULT_RECIPE, { height: 5 }).height).toBe(2.02);
    expect(applyAppearance(DEFAULT_RECIPE, { height: 0.5 }).height).toBe(1.45);
    expect(applyAppearance(DEFAULT_RECIPE, { height: NaN }).height).toBe(DEFAULT_RECIPE.height);
    expect(applyAppearance(DEFAULT_RECIPE, { top: "hivis" }).outfit).toBe("work");
    expect(applyAppearance(DEFAULT_RECIPE, { top: "sport" }).outfit).toBe("sport");
    expect(applyAppearance(DEFAULT_RECIPE, { top: "coat" }).outfit).toBe("city");
  });

  it("passe d'un gilet fluo à un haut ordinaire sans garder la couleur fluo", () => {
    const vest = applyAppearance(DEFAULT_RECIPE, { top: "hivis" });
    expect(isHivisColor(vest.topColor)).toBe(true);
    const back = applyAppearance(vest, { top: "shirt" });
    expect(isHivisColor(back.topColor)).toBe(false);
    expect(CLOTH_COLORS[back.topColor]).toBeDefined();
  });
});

describe("apparence enregistrée", () => {
  it("renvoie l'apparence par défaut quand rien n'est enregistré", () => {
    expect(new AppearanceStore(new Memory()).load()).toEqual(applyAppearance(DEFAULT_RECIPE));
    expect(new AppearanceStore(null).load()).toEqual(applyAppearance(DEFAULT_RECIPE));
  });

  it("fait l'aller-retour", () => {
    const mem = new Memory();
    const store = new AppearanceStore(mem);
    const r = applyAppearance(recipeFromSeed(77), { sex: "f", age: "senior" });
    expect(store.write(r)).toBe(true);
    expect(new AppearanceStore(mem).load()).toEqual(r);
  });

  it("se remet de n'importe quel contenu illisible ou d'une autre version", () => {
    for (const text of ["", "pas du json", "null", "[]", '{"version":99}', '{"version":1,"sex":"x","topColor":99}']) {
      const mem = new Memory();
      mem.setItem(APPEARANCE_KEY, text);
      const r = new AppearanceStore(mem).load();
      expect(isValidRecipe(r)).toBe(true);
    }
  });

  it("ne lève jamais d'exception quand le stockage refuse", () => {
    const refusing: StorageLike = { getItem() { throw new Error("interdit"); }, setItem() { throw new Error("plein"); }, removeItem() { throw new Error("interdit"); } };
    const store = new AppearanceStore(refusing);
    expect(isValidRecipe(store.load())).toBe(true);
    expect(store.write(DEFAULT_RECIPE)).toBe(false);
  });

  it("le tirage aléatoire donne des recettes valides, différentes d'un tirage à l'autre", () => {
    let i = 0;
    const rnd = (): number => ((i++ * 0.6180339887) % 1);
    const list = Array.from({ length: 50 }, () => randomAppearance(rnd));
    expect(list.every(isValidRecipe)).toBe(true);
    expect(new Set(list.map((r) => JSON.stringify(r))).size).toBeGreaterThan(45);
  });
});

describe("libellés", () => {
  it("couvrent tous les choix de l'écran", () => {
    const check = (labels: Record<string, string>, values: readonly string[]): string[] => values.filter((v) => !labels[v]);
    expect([
      ...check(LABELS.sex, SEXES), ...check(LABELS.age, AGES), ...check(LABELS.build, BUILDS), ...check(LABELS.hairStyle, HAIR_STYLES), ...check(LABELS.top, TOPS),
      ...check(LABELS.bottom, BOTTOMS), ...check(LABELS.shoes, SHOES), ...check(LABELS.hat, HATS), ...check(LABELS.glasses, GLASSES), ...check(LABELS.bag, BAGS), ...check(LABELS.beard, BEARDS),
    ]).toEqual([]);
  });
});

