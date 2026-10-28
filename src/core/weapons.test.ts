import { describe, expect, it } from "vitest";
import { Inventory, strikeTime, WEAPON_ORDER, WEAPONS } from "./weapons";
import { PART_SPECS, partMask, setPart } from "./character-kit";
import { recipeFromSeed } from "./character";

describe("catalogue d'armes", () => {
  it("a une fiche valide pour chaque arme, rangée dans l'ordre de la molette", () => {
    expect(WEAPON_ORDER.length).toBe(Object.keys(WEAPONS).length);
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      expect(w.id).toBe(id);
      expect(w.range).toBeGreaterThan(0);
      expect(w.damage).toBeGreaterThan(0);
      expect(w.rate).toBeGreaterThan(0);
      expect(w.hitAt).toBeGreaterThanOrEqual(0);
      expect(w.hitAt).toBeLessThan(1);
      if (w.kind === "melee") expect(w.mag).toBe(0);
      else expect(w.mag).toBeGreaterThan(0);
      // Une arme tenue a sa pièce dans le kit.
      if (w.part) expect(PART_SPECS.some((s) => s.id === w.part)).toBe(true);
    }
    // Les valeurs du cadrage (D80).
    expect(WEAPONS.fists.damage).toBe(12);
    expect(WEAPONS.knife.damage).toBe(40);
    expect(WEAPONS.bat.range).toBe(1.8);
    expect(strikeTime(WEAPONS.bat)).toBeCloseTo(1 / 1.2, 6);
  });

  it("les mains nues sont toujours là ; on prend, change et perd ses armes", () => {
    const inv = new Inventory();
    expect(inv.current.id).toBe("fists");
    expect(inv.list().map((w) => w.id)).toEqual(["fists"]);
    expect(inv.cycle().id).toBe("fists");
    expect(inv.select("bat")).toBe(false);
    expect(inv.grant("bat")).toBe(true);
    expect(inv.grant("bat")).toBe(false);
    inv.grant("knife");
    expect(inv.list().map((w) => w.id)).toEqual(["fists", "knife", "bat"]);
    expect(inv.cycle().id).toBe("knife");
    expect(inv.cycle().id).toBe("bat");
    expect(inv.cycle().id).toBe("fists");
    expect(inv.cycle(-1).id).toBe("bat");
    expect(inv.select("knife")).toBe(true);
    inv.grant("pistol", 24);
    expect(inv.ammo.pistol).toBe(24);
    inv.grant("pistol", 6);
    expect(inv.ammo.pistol).toBe(30);
    inv.loseAll();
    expect(inv.current.id).toBe("fists");
    expect(inv.list().map((w) => w.id)).toEqual(["fists"]);
    expect(inv.ammo.pistol).toBeUndefined();
    expect(inv.has("knife")).toBe(false);
  });
});

describe("armes tenues dans le masque de pièces", () => {
  it("setPart ajoute et retire une pièce sans toucher aux autres, et aucune recette n'en porte", () => {
    const r = recipeFromSeed(5);
    const base = Float32Array.from(partMask(r) as number[]);
    for (const w of Object.values(WEAPONS)) if (w.part) expect(PART_SPECS.find((s) => s.id === w.part)!.when(r)).toBe(false);
    const m = Float32Array.from(base);
    setPart(m, "weaponBat", true);
    expect(Array.from(m)).not.toEqual(Array.from(base));
    setPart(m, "weaponBat", true);
    setPart(m, "weaponKnife", true);
    setPart(m, "weaponBat", false);
    setPart(m, "weaponKnife", false);
    expect(Array.from(m)).toEqual(Array.from(base));
    setPart(m, "nexistepas", true);
    expect(Array.from(m)).toEqual(Array.from(base));
  });
});
