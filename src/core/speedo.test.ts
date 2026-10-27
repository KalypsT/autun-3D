import { describe, expect, it } from "vitest";
import { gaugeFraction, kmh } from "./speedo";
import { BIKE, CAR, MOTO, SCOOTER } from "./vehicle";

describe("compteur de vitesse", () => {
  it("convertit les m/s en km/h arrondis", () => {
    expect(kmh(0)).toBe(0);
    expect(kmh(10)).toBe(36);
    expect(kmh(27 / 3.6)).toBe(27);
    expect(kmh(0.1)).toBe(0);
    expect(kmh(0.14)).toBe(1);
  });
  it("affiche la marche arrière en valeur positive", () => {
    expect(kmh(-5)).toBe(18);
    expect(kmh(-0)).toBe(0);
  });
  it("rapporte la vitesse à la vitesse maximale, bornée à [0, 1]", () => {
    expect(gaugeFraction(0, 50)).toBe(0);
    expect(gaugeFraction(25, 50)).toBe(0.5);
    expect(gaugeFraction(-25, 50)).toBe(0.5);
    expect(gaugeFraction(80, 50)).toBe(1);
  });
  it("ne divise pas par une vitesse maximale nulle ou invalide", () => {
    expect(gaugeFraction(5, 0)).toBe(0);
    expect(gaugeFraction(5, NaN)).toBe(0);
  });
  it("remplit presque l'arc à la vitesse maximale de chaque véhicule", () => {
    for (const spec of [BIKE, SCOOTER, CAR, MOTO]) expect(gaugeFraction(spec.topSpeed, spec.topSpeed)).toBe(1);
  });
});
