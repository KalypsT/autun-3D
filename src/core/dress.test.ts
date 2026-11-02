import { describe, expect, it } from "vitest";
import { isValidRecipe, recipeFromSeed, type Recipe } from "./character";
import { airTemperature, coldAt, dressForCold, umbrellaShare } from "./dress";

const people = (hour: number, n = 1500): Recipe[] => Array.from({ length: n }, (_, i) => dressForCold(recipeFromSeed(i + 1), i + 1, coldAt(hour)));
const share = (list: Recipe[], f: (r: Recipe) => boolean): number => list.filter(f).length / list.length;

describe("vêtements selon l'heure", () => {
  it("la fraîcheur suit la journée", () => {
    expect(airTemperature(4)).toBeCloseTo(10, 5);
    expect(airTemperature(16)).toBeCloseTo(26, 5);
    expect(coldAt(4)).toBe(1);
    expect(coldAt(16)).toBe(0);
    expect(coldAt(9)).toBeGreaterThan(coldAt(12));
  });

  it("habille plus chaudement la nuit et plus légèrement l'après-midi", () => {
    const night = people(4), noon = people(16);
    const layered = (r: Recipe): boolean => ["jacket", "sweater", "coat", "hoodie"].includes(r.top);
    expect(share(night, layered)).toBeGreaterThan(share(noon, layered) + 0.3);
    expect(share(night, (r) => r.scarf)).toBeGreaterThan(share(noon, (r) => r.scarf) + 0.03);
    expect(share(noon, (r) => r.bottom === "shorts")).toBeGreaterThan(share(night, (r) => r.bottom === "shorts") + 0.1);
    expect(share(noon, (r) => r.glasses === "sun")).toBeGreaterThan(share(night, (r) => r.glasses === "sun"));
  });

  it("ne change que les vêtements : même personne, recettes valides, tenues de travail intactes, déterministe", () => {
    for (let i = 1; i <= 300; i++) {
      const base = recipeFromSeed(i), a = dressForCold(base, i, 1), b = dressForCold(base, i, 1);
      expect(a).toEqual(b);
      expect(isValidRecipe(a)).toBe(true);
      expect([a.sex, a.age, a.height, a.build, a.skin, a.hairStyle, a.hairColor]).toEqual([base.sex, base.age, base.height, base.build, base.skin, base.hairStyle, base.hairColor]);
      if (base.outfit === "work") expect(a).toBe(base);
    }
  });
});

describe("tenues selon la saison et la pluie (D197)", () => {
  it("l'hiver est froid à toute heure, l'été chaud l'après-midi ; la pluie rafraîchit", () => {
    expect(coldAt(15, 3)).toBe(1);
    expect(coldAt(15, 1)).toBe(0);
    expect(coldAt(9, 1, 1)).toBeGreaterThan(coldAt(9, 1));
    expect(coldAt(15)).toBe(coldAt(15, 1, 0));
  });

  it("en hiver, plus de manteaux et aucun t-shirt de ville ; l'été, l'inverse", () => {
    const count = (season: number, top: string): number => {
      let n = 0;
      for (let s = 0; s < 2000; s++) {
        const r = recipeFromSeed(s);
        if (r.outfit === "city" && dressForCold(r, s, coldAt(15, season)).top === top) n++;
      }
      return n;
    };
    expect(count(3, "coat")).toBeGreaterThan(count(1, "coat") * 3);
    expect(count(3, "tshirt")).toBeLessThan(count(1, "tshirt") / 4);
  });

  it("parapluies : aucun sans pluie, la moitié environ sous une bonne pluie", () => {
    expect(umbrellaShare(0)).toBe(0);
    expect(umbrellaShare(0.1)).toBe(0);
    expect(umbrellaShare(0.75)).toBeCloseTo(0.65);
    expect(umbrellaShare(1)).toBe(0.75);
  });
});
