import { describe, expect, it } from "vitest";
import { ZONE } from "../data/nav";
import { vehicleDef } from "./vehicle-catalog";
import { parkingZone, pickModel, placedModels, type PlacedFamily } from "./vehicle-placement";

const FAMILY_OF: Record<PlacedFamily, string[]> = { car: ["car"], moto: ["moto"], bike: ["bike"] };

/** Part de chaque modèle sur `n` tirages régulièrement répartis. */
function shares(family: PlacedFamily, zone: number, n = 10000): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = pickModel(family, zone, (i + 0.5) / n);
    out[id] = (out[id] ?? 0) + 1 / n;
  }
  return out;
}

describe("placement des véhicules par zone", () => {
  it("tous les modèles choisis existent au catalogue, avec la bonne famille", () => {
    for (const family of ["car", "moto", "bike"] as const) {
      for (const zone of Object.values(ZONE)) {
        for (const id of Object.keys(shares(family, zone, 200))) {
          expect([family, zone, id, FAMILY_OF[family]!.includes(vehicleDef(id)?.family ?? "")]).toEqual([family, zone, id, true]);
        }
      }
    }
    expect(placedModels().every((id) => vehicleDef(id) !== undefined)).toBe(true);
  });

  it("les poids de chaque zone font 100 : un tirage ne dépasse jamais le tableau", () => {
    for (const family of ["car", "moto", "bike"] as const) {
      for (const zone of Object.values(ZONE)) {
        const total = Object.values(shares(family, zone)).reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 6);
        expect(pickModel(family, zone, 0)).toBeTruthy();
        expect(pickModel(family, zone, 1)).toBeTruthy();
        expect(pickModel(family, zone, -1)).toBeTruthy();
      }
    }
  });

  it("voitures : citadines et compactes en centre, camionnettes en périphérie, sportives rares partout (≈ 2 %)", () => {
    const centre = shares("car", ZONE.centre), outskirts = shares("car", ZONE.outskirts), home = shares("car", ZONE.residential);
    expect(centre["citadine"]! + centre["compacte"]!).toBeGreaterThan(0.45);
    expect(outskirts["camionnette"]!).toBeGreaterThan(2 * centre["camionnette"]!);
    expect(home["break"]!).toBeGreaterThan(centre["break"]!);
    for (const s of [centre, outskirts, home]) expect(s["sportive"]!).toBeCloseTo(0.02, 2);
    // Les huit modèles existent dans chaque zone.
    for (const s of [centre, outskirts, home]) expect(Object.keys(s)).toHaveLength(8);
  });

  it("deux-roues : scooters en centre, plus de motos et de VTT loin du centre", () => {
    expect(shares("moto", ZONE.centre)["scooter-125"]!).toBeGreaterThan(shares("moto", ZONE.outskirts)["scooter-125"]!);
    expect(shares("moto", ZONE.outskirts)["moto-sportive"]!).toBeGreaterThan(shares("moto", ZONE.centre)["moto-sportive"]!);
    expect(shares("bike", ZONE.nature)["vtt"]!).toBeGreaterThan(shares("bike", ZONE.centre)["vtt"]!);
  });

  it("la zone d'une place vient du nombre de bâtiments de sa tuile et de la distance à la mairie", () => {
    expect(parkingZone(100, 50, 200)).toBe(ZONE.centre);
    expect(parkingZone(800, 0, 200)).toBe(ZONE.residential);
    expect(parkingZone(100, 50, 60)).toBe(ZONE.residential);
    expect(parkingZone(1200, 900, 10)).toBe(ZONE.outskirts);
    expect(parkingZone(1200, 900, 0)).toBe(ZONE.nature);
  });
});
