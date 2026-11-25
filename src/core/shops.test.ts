import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_DATA } from "../data/data-version";
import { closingHour, hourText, nextOpening, openingText, scheduleOf } from "./opening";
import { canBuy, canBuyWeapon, foodShops, MENUS, shopAt, shopHours, shopOpen, weaponShops } from "./shops";
import { Inventory } from "./weapons";

describe("magasins (D322)", () => {
  const places = (JSON.parse(readFileSync(`${PUBLIC_DATA}/map/places.json`, "utf8")) as { places: { id: string; cat: string; name?: string; kind?: string; x: number; y: number }[] }).places;
  const shops = foodShops(places);

  it("les commerces de bouche de la carte, chacun avec ce qu'il vend", () => {
    expect(shops.length).toBeGreaterThan(60);
    expect(shops.find((s) => s.name === "McDonald's")?.items.map((i) => i.name)).toEqual(["Sandwich ou kebab", "Menu"]);
    expect(shops.some((s) => s.kind === "bakery")).toBe(true);
    for (const s of shops) for (const i of s.items) expect(Number.isInteger(i.price) && i.price > 0).toBe(true);
    for (const m of Object.values(MENUS)) expect(m.length).toBeGreaterThan(0);
  });

  it("on entre à quelques mètres du point du commerce, plus loin pour une grande surface", () => {
    const b = shops.find((s) => s.kind === "bakery")!;
    expect(shopAt(shops, b.x + 5, b.y)?.id).toBe(b.id);
    expect(shopAt(shops, b.x + 30, b.y + 30)?.id).not.toBe(b.id);
    const m = shops.find((s) => s.kind === "supermarket")!;
    expect(shopAt(shops, m.x + 25, m.y)?.id).toBe(m.id);
  });

  it("horaires : ouvert, fermé, prochaine ouverture lisible", () => {
    const b = shops.find((s) => s.kind === "bakery")!;
    expect(shopOpen(b, 2, 10)).toBe(true);
    expect(shopOpen(b, 2, 21)).toBe(false);
    expect(shopHours(b, 2, 10)).toBe("Ouvert jusqu'à 19 h 30");
    expect(shopHours(b, 2, 21)).toBe("Fermé · ouvre demain à 7 h");
    // Boutique fermée le dimanche, le lundi matin : ouvre lundi à 14 h.
    expect(openingText(scheduleOf("clothes"), 6, 15)).toBe("ouvre demain à 14 h");
    expect(openingText(scheduleOf("clothes"), 5, 20)).toBe("ouvre lundi à 14 h");
    expect(openingText(scheduleOf("vacant"), 1, 10)).toBe("ne rouvre pas");
    expect(nextOpening(scheduleOf("bakery"), 0, 6)).toEqual({ days: 0, hour: 7 });
    // Bar ouvert jusqu'à 1 h : à 0 h 30, encore ouvert, jusqu'à 1 h.
    expect(closingHour(scheduleOf("bar"), 3, 0.5)).toBe(1);
    expect(hourText(9.5)).toBe("9 h 30");
    expect(hourText(24)).toBe("minuit");
  });

  it("achat : refusé sans argent, et quand la santé est déjà pleine", () => {
    const sandwich = MENUS["bakery"]![1]!;
    expect(canBuy(sandwich, 3, 40, 100)).toBe("Il manque 4\u00a0€");
    expect(canBuy(sandwich, 20, 100, 100)).toBe("Santé pleine");
    expect(canBuy(sandwich, 20, 40, 100)).toBeNull();
  });
});

describe("armureries (D324)", () => {
  const places = (JSON.parse(readFileSync(`${PUBLIC_DATA}/map/places.json`, "utf8")) as { places: { id: string; cat: string; name?: string; kind?: string; x: number; y: number }[] }).places;
  const shops = weaponShops(places);

  it("James et le Surplus Éduen, chacun avec ses armes et ses munitions", () => {
    expect(shops.map((s) => s.name)).toEqual(["James", "Surplus Éduen"]);
    expect(shops[0]!.items.filter((i) => !i.ammo).map((i) => i.weapon)).toEqual(["pistol", "shotgun", "sniper"]);
    expect(shops[1]!.items.filter((i) => !i.ammo).map((i) => i.weapon)).toEqual(["knife", "bat", "rifle"]);
    for (const s of shops) for (const i of s.items) if (i.ammo) expect(s.items.some((q) => q.weapon === i.weapon && !q.ammo)).toBe(true);
  });

  it("refus : déjà à toi, munitions sans l'arme, réserve pleine, pas assez d'argent", () => {
    const inv = new Inventory();
    const pistol = shops[0]!.items.find((i) => i.weapon === "pistol" && !i.ammo)!, bullets = shops[0]!.items.find((i) => i.weapon === "pistol" && i.ammo)!;
    expect(canBuyWeapon(pistol, 100, inv)).toBe("Il manque 300\u00a0€");
    expect(canBuyWeapon(bullets, 100, inv)).toBe("Il te faut l'arme");
    expect(canBuyWeapon(pistol, 1000, inv)).toBeNull();
    inv.grant("pistol", 12);
    expect(canBuyWeapon(pistol, 1000, inv)).toBe("Déjà à toi");
    expect(canBuyWeapon(bullets, 1000, inv)).toBeNull();
    inv.grant("pistol", 1000);
    expect(canBuyWeapon(bullets, 1000, inv)).toBe("Réserve pleine");
  });
});
