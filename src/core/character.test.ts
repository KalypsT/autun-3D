import { describe, expect, it } from "vitest";
import {
  AGES, BAGS, BEARDS, BOTTOMS, BUILDS, createRng, DEFAULT_RECIPE, GLASSES, HAIR_STYLES, HATS, HEIGHT_RANGE, isHivisColor, isValidRecipe,
  OUTFITS, parseRecipe, recipeColors, recipeFromSeed, serializeRecipe, SHOES, TOPS, bodyDims, type Recipe,
} from "./character";

const seeds = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);

describe("hasard à graine", () => {
  it("rejoue la même suite pour la même graine, une autre suite pour une autre graine", () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const sa = Array.from({ length: 8 }, a), sb = Array.from({ length: 8 }, b), sc = Array.from({ length: 8 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("recette tirée d'une graine", () => {
  it("est déterministe", () => {
    for (const s of [0, 1, 7, 123456, 4294967295, -5]) expect(recipeFromSeed(s)).toEqual(recipeFromSeed(s));
  });

  it("reste dans les bornes pour toutes les graines (une seule vérification groupée)", () => {
    const bad = seeds(3000, 0).filter((s) => !isValidRecipe(recipeFromSeed(s)));
    expect(bad).toEqual([]);
  });

  it("respecte la cohérence des tenues (une seule vérification groupée)", () => {
    const bad: string[] = [];
    for (const s of seeds(3000, 0)) {
      const r = recipeFromSeed(s);
      if (r.sex === "f" && r.beard !== "none") bad.push(`${s}: barbe`);
      if (r.hat === "helmet" && r.top !== "hivis") bad.push(`${s}: casque sans gilet`);
      if (r.top === "hivis" && (!isHivisColor(r.topColor) || r.bottom !== "work" || r.shoes !== "boots")) bad.push(`${s}: gilet`);
      if (r.top !== "hivis" && isHivisColor(r.topColor)) bad.push(`${s}: fluo hors gilet`);
      if (r.outfit === "sport" && (r.bottom !== "jogging" && r.bottom !== "shorts")) bad.push(`${s}: sport`);
      if (r.outfit === "sport" && r.shoes !== "sneakers") bad.push(`${s}: chaussures de sport`);
      if (r.bag === "handbag" && r.sex === "m") bad.push(`${s}: sac à main`);
      if (r.bottom === "skirt" && r.sex === "m") bad.push(`${s}: jupe`);
      if (r.outfit !== "work" && (r.top === "hivis" || r.top === "apron")) bad.push(`${s}: tenue de travail`);
      if (r.scarf && r.outfit !== "city") bad.push(`${s}: écharpe`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("suit une distribution vraisemblable", () => {
    const all = seeds(5000, 0).map(recipeFromSeed);
    const share = (p: (r: Recipe) => boolean): number => all.filter(p).length / all.length;
    const mean = (p: (r: Recipe) => boolean): number => {
      const l = all.filter(p);
      return l.reduce((s, r) => s + r.height, 0) / l.length;
    };
    expect(share((r) => r.sex === "f")).toBeGreaterThan(0.47);
    expect(share((r) => r.sex === "f")).toBeLessThan(0.57);
    expect(share((r) => r.age === "senior")).toBeGreaterThan(0.2);
    expect(share((r) => r.age === "senior")).toBeLessThan(0.36);
    const men = mean((r) => r.sex === "m" && r.age === "adult"), women = mean((r) => r.sex === "f" && r.age === "adult");
    expect(men).toBeGreaterThan(1.74);
    expect(men).toBeLessThan(1.82);
    expect(women).toBeGreaterThan(1.61);
    expect(women).toBeLessThan(1.69);
    expect(men - women).toBeGreaterThan(0.09);
    expect(mean((r) => r.sex === "m" && r.age === "senior")).toBeLessThan(men);
    // Les cheveux gris ou blancs dominent chez les seniors, restent l'exception chez les adultes.
    const gray = (r: Recipe): boolean => r.hairColor === 7 || r.hairColor === 8;
    expect(share((r) => r.age === "senior" && gray(r)) / share((r) => r.age === "senior")).toBeGreaterThan(0.55);
    expect(share((r) => r.age === "adult" && gray(r)) / share((r) => r.age === "adult")).toBeLessThan(0.08);
    // Majorité de tenues de ville ; un peu de sport et de travail.
    expect(share((r) => r.outfit === "city")).toBeGreaterThan(0.65);
    expect(share((r) => r.outfit === "sport")).toBeGreaterThan(0.05);
    expect(share((r) => r.outfit === "work")).toBeGreaterThan(0.05);
  });

  it("couvre toutes les pièces sur un grand tirage", () => {
    const all = seeds(5000, 0).map(recipeFromSeed);
    const seen = <T>(pick: (r: Recipe) => T): Set<T> => new Set(all.map(pick));
    expect(seen((r) => r.hairStyle).size).toBe(HAIR_STYLES.length);
    expect(seen((r) => r.top).size).toBe(TOPS.length);
    expect(seen((r) => r.bottom).size).toBe(BOTTOMS.length);
    expect(seen((r) => r.shoes).size).toBe(SHOES.length);
    expect(seen((r) => r.hat).size).toBe(HATS.length);
    expect(seen((r) => r.glasses).size).toBe(GLASSES.length);
    expect(seen((r) => r.bag).size).toBe(BAGS.length);
    expect(seen((r) => r.beard).size).toBe(BEARDS.length);
    expect(seen((r) => r.build).size).toBe(BUILDS.length);
    expect(seen((r) => r.age).size).toBe(AGES.length);
    expect(seen((r) => r.outfit).size).toBe(OUTFITS.length);
    expect(seen((r) => r.skin).size).toBe(6);
    expect(seen((r) => r.hairColor).size).toBe(10);
  });

  it("donne des personnages variés : aucune recette identique, très peu de quasi-jumeaux", () => {
    // 19 critères ; la taille compte par tranches de 5 cm.
    const keys = seeds(1000).map(recipeFromSeed).map((r) => [
      r.sex, r.age, Math.round(r.height * 20), r.build, r.skin, r.hairStyle, r.hairColor, r.top, r.topColor, r.bottom, r.bottomColor,
      r.shoes, r.shoeColor, r.hat, r.glasses, r.bag, r.beard, r.scarf, r.outfit,
    ]);
    let max = 0, close = 0, pairs = 0;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        let same = 0;
        const a = keys[i]!, b = keys[j]!;
        for (let k = 0; k < a.length; k++) if (a[k] === b[k]) same++;
        pairs++;
        if (same >= 15) close++;
        if (same > max) max = same;
      }
    }
    expect(keys[0]!.length).toBe(19);
    expect(max).toBeLessThan(19);
    expect(close / pairs).toBeLessThan(0.001);
    expect(new Set(keys.map((k) => k.join("|"))).size).toBe(1000);
  });
});

describe("sérialisation", () => {
  it("fait l'aller-retour sans rien perdre", () => {
    for (const s of seeds(50)) {
      const r = recipeFromSeed(s);
      expect(parseRecipe(serializeRecipe(r))).toEqual(r);
    }
    expect(parseRecipe(serializeRecipe(DEFAULT_RECIPE))).toEqual(DEFAULT_RECIPE);
  });

  it("refuse ce qui n'est pas une recette", () => {
    for (const t of [null, "", "pas du json", "42", "null", "[]", '"x"', JSON.stringify({ sex: "m" }), JSON.stringify({ version: 99, ...DEFAULT_RECIPE })]) {
      expect(parseRecipe(t)).toBeNull();
    }
  });

  it("répare champ par champ ce qui est invalide", () => {
    const text = JSON.stringify({
      version: 1, ...recipeFromSeed(5), sex: "x", age: 3, height: 9, skin: 99, hairStyle: "iroquois", hairColor: -1, topColor: 1.5,
      scarf: "oui", bottomColor: "bleu", hat: null,
    });
    const r = parseRecipe(text)!;
    expect(isValidRecipe(r)).toBe(true);
    expect(r.sex).toBe(DEFAULT_RECIPE.sex);
    expect(r.age).toBe(DEFAULT_RECIPE.age);
    expect(r.height).toBe(HEIGHT_RANGE.max);
    expect(r.skin).toBe(DEFAULT_RECIPE.skin);
    expect(r.hairStyle).toBe(DEFAULT_RECIPE.hairStyle);
    expect(r.hairColor).toBe(DEFAULT_RECIPE.hairColor);
    expect(r.topColor).toBe(DEFAULT_RECIPE.topColor);
    expect(r.scarf).toBe(DEFAULT_RECIPE.scarf);
    expect(r.bottomColor).toBe(DEFAULT_RECIPE.bottomColor);
    expect(r.hat).toBe(DEFAULT_RECIPE.hat);
    // Les champs valides sont conservés.
    expect(r.top).toBe(recipeFromSeed(5).top);
    expect(r.shoes).toBe(recipeFromSeed(5).shoes);
  });

  it("borne la taille trop petite et ignore NaN", () => {
    expect(parseRecipe(JSON.stringify({ version: 1, height: 0.2 }))!.height).toBe(HEIGHT_RANGE.min);
    expect(parseRecipe('{"version":1,"height":"grand"}')!.height).toBe(DEFAULT_RECIPE.height);
  });

  it("la recette par défaut est valide et résout toutes ses couleurs", () => {
    expect(isValidRecipe(DEFAULT_RECIPE)).toBe(true);
    for (const c of Object.values(recipeColors(DEFAULT_RECIPE))) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("mesures du corps", () => {
  it("garde des proportions humaines pour toutes les tailles et corpulences", () => {
    const bad: string[] = [];
    for (const sex of ["f", "m"] as const) {
      for (const age of AGES) {
        for (const build of BUILDS) {
          for (const height of [HEIGHT_RANGE.min, 1.65, 1.78, HEIGHT_RANGE.max]) {
            const d = bodyDims({ ...DEFAULT_RECIPE, sex, age, build, height });
            const tag = `${sex} ${age} ${build} ${height}`;
            if (!(d.ankleY < d.kneeY && d.kneeY < d.hipY && d.hipY < d.shoulderY && d.shoulderY < d.neckY && d.neckY < d.headCenterY && d.headCenterY < height)) bad.push(`${tag}: ordre`);
            // Les jambes (hanche au sol) font un peu plus de la moitié de la taille ; la tête, environ 1/7,5.
            if (Math.abs(d.thigh + d.shin + d.ankleY - d.hipY) > 1e-9) bad.push(`${tag}: jambe`);
            if (d.hipY / height < 0.5 || d.hipY / height > 0.55) bad.push(`${tag}: hanche`);
            if (d.headRadius * 2 / height < 0.12 || d.headRadius * 2 / height > 0.14) bad.push(`${tag}: tête`);
            if (d.shoulderHalf < d.waistHalf * 0.9) bad.push(`${tag}: épaules`);
            if (d.torsoDepth <= 0 || d.limbRadius <= 0) bad.push(`${tag}: volumes`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("élargit le corps avec la corpulence, et épaissit le ventre plus que les épaules", () => {
    const slim = bodyDims({ ...DEFAULT_RECIPE, build: "slim" }), heavy = bodyDims({ ...DEFAULT_RECIPE, build: "heavy" });
    expect(heavy.waistHalf).toBeGreaterThan(slim.waistHalf * 1.4);
    expect(heavy.torsoDepth / slim.torsoDepth).toBeGreaterThan(heavy.shoulderHalf / slim.shoulderHalf);
  });

  it("donne des hanches plus larges et des épaules plus étroites aux femmes à taille égale, et voûte les seniors", () => {
    const m = bodyDims({ ...DEFAULT_RECIPE, sex: "m", height: 1.7 }), f = bodyDims({ ...DEFAULT_RECIPE, sex: "f", height: 1.7 });
    expect(f.shoulderHalf).toBeLessThan(m.shoulderHalf);
    expect(f.hipHalf).toBeGreaterThan(m.hipHalf);
    expect(bodyDims({ ...DEFAULT_RECIPE, age: "senior" }).stoop).toBeGreaterThan(bodyDims(DEFAULT_RECIPE).stoop);
  });
});
