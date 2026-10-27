import { describe, expect, it } from "vitest";
import { recipeFromSeed, type Recipe } from "./character";
import { BONE_COUNT } from "./character-rig";
import { countParts, MAX_PARTS, partMask, PART_SPECS, SLOT, SLOT_COUNT, visibleParts } from "./character-kit";

const recipes = (n: number): Recipe[] => Array.from({ length: n }, (_, i) => recipeFromSeed(i + 1));
const present = (r: Recipe): Set<string> => new Set(PART_SPECS.filter((s) => s.when(r)).map((s) => s.id));

describe("catalogue de pièces", () => {
  it("a des identifiants uniques, des os et des emplacements valides", () => {
    expect(new Set(PART_SPECS.map((s) => s.id)).size).toBe(PART_SPECS.length);
    expect(PART_SPECS.length).toBeLessThanOrEqual(MAX_PARTS);
    for (const s of PART_SPECS) {
      expect(s.bones.length).toBeGreaterThan(0);
      expect(s.bones.every((b) => b >= 0 && b < BONE_COUNT)).toBe(true);
      expect(s.slot).toBeGreaterThanOrEqual(-1);
      expect(s.slot).toBeLessThan(SLOT_COUNT);
    }
  });

  it("habille chaque recette de façon cohérente (une seule vérification groupée)", () => {
    const bad: string[] = [];
    for (const r of recipes(3000)) {
      const p = present(r);
      const one = (ids: string[], label: string): void => {
        if (ids.filter((i) => p.has(i)).length !== 1) bad.push(`${label}: ${ids.filter((i) => p.has(i)).join("+") || "aucun"} (${r.top} ${r.bottom})`);
      };
      one(["torsoTop", "torsoApron"], "torse");
      one(["pelvis", "skirt"], "bassin");
      if (!p.has("head") || !p.has("neck") || !p.has("hands") || !p.has("foot")) bad.push("corps incomplet");
      // Bras : peau nue ou manche, jamais les deux, jamais rien.
      const shortSleeve = p.has("sleeveShort"), longSleeve = ["sleeveLongTop", "sleeveLongApron", "sleeveLongWork"].some((i) => p.has(i));
      if (shortSleeve === longSleeve) bad.push(`manches: ${r.top}`);
      if (shortSleeve !== (p.has("armSkinUpper") && p.has("armSkinFore"))) bad.push(`peau des bras: ${r.top}`);
      if (longSleeve !== ["foreSleeveTop", "foreSleeveApron", "foreSleeveWork"].some((i) => p.has(i))) bad.push(`avant-bras: ${r.top}`);
      // Jambes : pantalon long, short + peau, ou jupe + peau, jamais une jambe sans rien.
      const long = p.has("thighCloth") && p.has("shinCloth");
      const shorts = p.has("thighShorts") && p.has("thighSkinLower") && p.has("shinSkin");
      const skirt = p.has("skirt") && p.has("thighSkinFull") && p.has("shinSkin");
      if ([long, shorts, skirt].filter(Boolean).length !== 1) bad.push(`jambes: ${r.bottom}`);
      if (p.has("hatHelmet") && !p.has("stripes")) bad.push("casque sans gilet");
      if (["bootShaft", "sole"].filter((i) => p.has(i)).length !== (r.shoes === "leather" ? 0 : 1)) bad.push(`chaussures: ${r.shoes}`);
      if (Array.from(p).filter((i) => i.startsWith("hair")).length !== (r.hairStyle === "bald" ? 0 : 1)) bad.push(`cheveux: ${r.hairStyle}`);
      if (Array.from(p).filter((i) => i.startsWith("hat")).length !== (r.hat === "none" ? 0 : 1)) bad.push(`chapeau: ${r.hat}`);
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it("n'utilise que les emplacements prévus et réserve les emplacements de couleur à ce qu'il faut", () => {
    const bySlot = (slot: number): string[] => PART_SPECS.filter((s) => s.slot === slot).map((s) => s.id);
    expect(bySlot(SLOT.hair).every((i) => i.startsWith("hair") || i === "mustache" || i === "beard")).toBe(true);
    expect(bySlot(SLOT.shoes).sort()).toEqual(["bootShaft", "foot"]);
    expect(bySlot(SLOT.bag).sort()).toEqual(["backpack", "handbag", "shoulderBag"]);
  });

  it("garde un nombre de pièces raisonnable par personnage", () => {
    const counts = recipes(1000).map((r) => countParts(r));
    const avg = counts.reduce((s, c) => s + c.pieces, 0) / counts.length;
    const max = Math.max(...counts.map((c) => c.pieces));
    expect(avg).toBeGreaterThan(18);
    expect(avg).toBeLessThan(30);
    expect(max).toBeLessThan(40);
  });

  it("encode le masque exactement : un bit par pièce visible", () => {
    const bad: string[] = [];
    for (const r of recipes(500)) {
      const vis = visibleParts(r), mask = partMask(r) as number[];
      for (let i = 0; i < PART_SPECS.length; i++) {
        const bit = Math.floor(mask[Math.floor(i / 22)]! / 2 ** (i % 22)) % 2 === 1;
        if (bit !== vis[i]) bad.push(`${PART_SPECS[i]!.id}`);
      }
      for (const w of mask) if (!Number.isInteger(w) || w >= 2 ** 22) bad.push("mot hors bornes");
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
