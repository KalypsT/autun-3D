import { describe, expect, it } from "vitest";
import { hourlyT, seasonLook } from "./seasons";

describe("saisons : ce qui change au décor (D197)", () => {
  it("arbres : nus l'hiver et au tout début du printemps, verts l'été, colorés puis nus à l'automne", () => {
    expect(seasonLook(3, 0.5)).toMatchObject({ bare: 1, turn: 1 });
    expect(seasonLook(0, 0).bare).toBe(1);
    expect(seasonLook(0, 0.6)).toMatchObject({ bare: 0, turn: 0 });
    expect(seasonLook(0, 0.6).fresh).toBeGreaterThan(0.5);
    expect(seasonLook(1, 0.5)).toMatchObject({ bare: 0, turn: 0, fresh: 0 });
    expect(seasonLook(2, 0.45).turn).toBeGreaterThan(0.9);
    expect(seasonLook(2, 0.45).bare).toBe(0);
    expect(seasonLook(2, 0.99).bare).toBeGreaterThan(0.95);
  });

  it("sol : herbe jaunie à la fin de l'été, feuilles mortes de la mi-automne au début de l'hiver", () => {
    expect(seasonLook(1, 0.2).dry).toBe(0);
    expect(seasonLook(1, 0.95).dry).toBeGreaterThan(0.6);
    expect(seasonLook(2, 0.1).litter).toBe(0);
    expect(seasonLook(2, 0.9).litter).toBe(1);
    expect(seasonLook(3, 0.1).litter).toBeGreaterThan(0.8);
    expect(seasonLook(3, 0.6).litter).toBe(0);
    expect(seasonLook(3, 0.6).dull).toBe(1);
  });

  it("toutes les valeurs restent entre 0 et 1, sans saut entre deux saisons", () => {
    const keys = ["fresh", "turn", "bare", "dry", "dull", "litter"] as const;
    for (let s = 0; s < 4; s++) for (let t = 0; t < 1; t += 0.01) for (const k of keys) {
      const v = seasonLook(s as 0, t)[k];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (let s = 0; s < 4; s++) {
      const end = seasonLook(s as 0, 0.9999), next = seasonLook(((s + 1) % 4) as 0, 0);
      for (const k of keys) expect(Math.abs(end[k] - next[k])).toBeLessThan(0.12);
    }
  });

  it("l'avancement est arrondi à l'heure de jeu", () => {
    expect(hourlyT(3, 14.9, 7)).toBe(hourlyT(3, 14.1, 7));
    expect(hourlyT(3, 15, 7)).toBeGreaterThan(hourlyT(3, 14.9, 7));
  });
});
