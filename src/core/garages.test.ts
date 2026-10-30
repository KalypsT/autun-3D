import { describe, expect, it } from "vitest";
import { GARAGE, garageAt, garagesFrom, GarageStop } from "./garages";

describe("garages de réparation (D113)", () => {
  const garages = garagesFrom([
    { name: "Norauto", kind: "car_repair", x: 0, y: 0 },
    { name: "Boulangerie", kind: "bakery", x: 50, y: 0 },
    { name: "Renault", kind: "car_repair", x: 100, y: 0 },
  ]);

  it("seuls les garages automobiles de la carte comptent ; on est devant l'un d'eux à moins de sa portée", () => {
    expect(garages.map((g) => g.name)).toEqual(["Norauto", "Renault"]);
    expect(garageAt(garages, 10, 5)?.name).toBe("Norauto");
    expect(garageAt(garages, 50, 0)).toBeNull();
  });

  it("arrêté devant un garage au volant d'un véhicule abîmé : réparé une seule fois, après une courte attente ; en roulant ou intact, rien", () => {
    const stop = new GarageStop();
    expect(stop.update(0.5, garages, 5, 0, 0, true)).toBeNull();
    expect(stop.update(GARAGE.wait, garages, 5, 0, 0, true)?.name).toBe("Norauto");
    expect(stop.update(1, garages, 5, 0, 0, true)).toBeNull();
    const moving = new GarageStop();
    for (let i = 0; i < 10; i++) expect(moving.update(0.5, garages, 5, 0, 5, true)).toBeNull();
    const fine = new GarageStop();
    for (let i = 0; i < 10; i++) expect(fine.update(0.5, garages, 5, 0, 0, false)).toBeNull();
  });
});
