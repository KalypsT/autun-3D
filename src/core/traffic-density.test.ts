import { describe, expect, it } from "vitest";
import { ZONE } from "../data/nav";
import { trafficDensity, trafficTarget } from "./traffic-density";

describe("densité de circulation (D64)", () => {
  it("a deux pointes (matin et soir) et une nuit plus calme, sans jamais s'annuler", () => {
    for (const zone of [ZONE.centre, ZONE.residential, ZONE.outskirts]) {
      const peak = Math.max(trafficDensity(8, zone), trafficDensity(18, zone));
      expect(trafficDensity(8, zone)).toBeGreaterThan(trafficDensity(11, zone));
      expect(trafficDensity(18, zone)).toBeGreaterThan(trafficDensity(15, zone));
      expect(trafficDensity(3, zone)).toBeLessThan(peak * 0.4);
      expect(trafficDensity(3, zone)).toBeGreaterThan(0);
    }
  });

  it("classe les zones : centre > résidentiel > périphérie > nature, à toute heure", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = [ZONE.centre, ZONE.residential, ZONE.outskirts, ZONE.nature].map((z) => trafficDensity(h, z));
      expect(d[0]!).toBeGreaterThan(d[1]!);
      expect(d[1]!).toBeGreaterThan(d[2]!);
      expect(d[2]!).toBeGreaterThan(d[3]!);
    }
  });

  it("la cible suit la capacité : 20 voitures en pointe au centre, 6 la nuit (≈ 8 pour 25), jamais 0 hors nature, 0 sans capacité", () => {
    expect(trafficTarget(20, 8, ZONE.centre, 0)).toBe(20);
    expect(trafficTarget(20, 3, ZONE.centre, 0)).toBe(6);
    expect(trafficTarget(0, 8, ZONE.centre, 0)).toBe(0);
    expect(trafficTarget(10, 3, ZONE.outskirts, 0)).toBeGreaterThanOrEqual(1);
    expect(trafficTarget(10, 3, ZONE.nature, 0)).toBe(0);
  });

  it("baisse de moitié au plus quand on roule vite, progressivement entre 12 et 25 m/s", () => {
    const slow = trafficTarget(30, 8, ZONE.centre, 5), mid = trafficTarget(30, 8, ZONE.centre, 18), fast = trafficTarget(30, 8, ZONE.centre, 40);
    expect(slow).toBe(30);
    expect(mid).toBeLessThan(slow);
    expect(mid).toBeGreaterThan(fast);
    expect(fast).toBe(15);
  });
});
