import { describe, expect, it } from "vitest";
import { sunDirection, sunPosition } from "./sun";

const deg = (r: number) => (r * 180) / Math.PI;

describe("sunPosition", () => {
  it("midi solaire de solstice d'été : plein sud, environ 64°", () => {
    const s = sunPosition(172, 12);
    expect(deg(s.elevation)).toBeCloseTo(90 - 46.95 + 23.44, 0);
    expect(deg(s.azimuth)).toBeCloseTo(180, 0);
  });

  it("le matin le soleil est à l'est, le soir à l'ouest", () => {
    expect(deg(sunPosition(172, 8).azimuth)).toBeLessThan(120);
    expect(deg(sunPosition(172, 18).azimuth)).toBeGreaterThan(240);
  });

  it("la nuit il est sous l'horizon", () => {
    expect(sunPosition(172, 0).elevation).toBeLessThan(0);
    expect(sunPosition(355, 12).elevation).toBeGreaterThan(0);
    expect(deg(sunPosition(355, 12).elevation)).toBeCloseTo(90 - 46.95 - 23.44, 0);
  });

  it("donne un vecteur unitaire dirigé vers le sud à midi", () => {
    const [x, y, z] = sunDirection(sunPosition(172, 12));
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(y).toBeLessThan(0);
    expect(Math.abs(x)).toBeLessThan(1e-6);
  });
});
