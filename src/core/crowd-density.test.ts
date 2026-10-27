import { describe, expect, it } from "vitest";
import { ZONE } from "../data/nav";
import { crowdDensity, crowdTarget } from "./crowd-density";

describe("densité de passants", () => {
  it("suit la table de D39 au centre : nuit presque vide, midi plein, soirée à moitié", () => {
    expect(crowdDensity(3, ZONE.centre)).toBeLessThan(0.06);
    expect(crowdDensity(13, ZONE.centre)).toBe(1);
    expect(crowdDensity(8, ZONE.centre)).toBeGreaterThan(0.6);
    expect(crowdDensity(20, ZONE.centre)).toBeGreaterThan(0.5);
    expect(crowdDensity(20, ZONE.centre)).toBeLessThan(0.75);
    expect(crowdDensity(23, ZONE.centre)).toBeLessThan(0.25);
  });

  it("pèse chaque zone : centre, puis résidentiel, puis périphérie et nature", () => {
    for (const h of [8, 13, 18]) {
      const d = [ZONE.centre, ZONE.residential, ZONE.outskirts, ZONE.nature].map((z) => crowdDensity(h, z));
      expect(d[0]).toBeGreaterThan(d[1]!);
      expect(d[1]).toBeGreaterThan(d[2]!);
      expect(d[2]).toBeGreaterThanOrEqual(d[3]! - 1e-9);
    }
    expect(crowdDensity(13, ZONE.outskirts)).toBeCloseTo(0.1, 5);
  });

  it("a ses pointes du matin et du soir dans les quartiers d'habitation, et ne dépasse jamais 1", () => {
    expect(crowdDensity(8, ZONE.residential)).toBeGreaterThan(crowdDensity(14, ZONE.residential));
    expect(crowdDensity(18, ZONE.residential)).toBeGreaterThan(crowdDensity(14, ZONE.residential));
    const all: number[] = [];
    for (let h = 0; h < 24; h += 0.25) for (const z of [0, 1, 2, 3]) all.push(crowdDensity(h, z));
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
    expect(Math.min(...all)).toBeGreaterThan(0);
  });

  it("est continue : jamais de saut de plus de 0,55 d'une demi-heure à l'autre, minuit raccordé", () => {
    const jumps: number[] = [];
    for (let h = 0; h < 24; h += 0.5) for (const z of [0, 1, 2]) jumps.push(Math.abs(crowdDensity(h + 0.5, z) - crowdDensity(h, z)));
    expect(Math.max(...jumps)).toBeLessThan(0.55);
    expect(crowdDensity(24, ZONE.centre)).toBeCloseTo(crowdDensity(0, ZONE.centre), 5);
    expect(crowdDensity(-1, ZONE.centre)).toBeCloseTo(crowdDensity(23, ZONE.centre), 5);
  });

  it("réduit la cible en roulant vite : entière à l'arrêt, de moitié à 12 m/s", () => {
    expect(crowdTarget(100, 13, ZONE.centre, 0)).toBe(100);
    expect(crowdTarget(100, 13, ZONE.centre, 6)).toBe(100);
    expect(crowdTarget(100, 13, ZONE.centre, 12)).toBe(50);
    expect(crowdTarget(100, 13, ZONE.centre, 30)).toBe(50);
    expect(crowdTarget(150, 3, ZONE.centre, 0)).toBeLessThan(10);
  });
});
