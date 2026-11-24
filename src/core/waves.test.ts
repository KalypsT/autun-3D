import { describe, expect, it } from "vitest";
import { SWELL_TERMS, WAVE_LOOP, waveAmplitude, waveHeight, waveSlope, WAVES_GLSL } from "./waves";

describe("vagues de la mer (D316)", () => {
  it("la mer se répète exactement toutes les 60 s (le temps se replie sans saut)", () => {
    for (const [x, y] of [[0, 0], [-1630, 180], [2100, 570]] as [number, number][]) {
      expect(waveHeight(x, y, 12.3 + WAVE_LOOP, 0.3)).toBeCloseTo(waveHeight(x, y, 12.3, 0.3), 9);
      expect(waveHeight(x, y, WAVE_LOOP - 1e-6, 0.3)).toBeCloseTo(waveHeight(x, y, 0, 0.3), 4);
    }
  });

  it("hauteur bornée par l'amplitude ; calme 0,1 m, orage 0,4 m ; houles de 7 à 22 m de long, de 2 à 4 s", () => {
    expect(waveAmplitude(0)).toBeCloseTo(0.1);
    expect(waveAmplitude(1)).toBeCloseTo(0.4);
    let max = 0;
    for (let i = 0; i < 2000; i++) max = Math.max(max, Math.abs(waveHeight(i * 3.7, i * 1.3, i * 0.11, 0.4)));
    expect(max).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(max).toBeGreaterThan(0.25);
    for (const s of SWELL_TERMS) {
      const L = (2 * Math.PI) / s.k, T = (2 * Math.PI) / s.w;
      expect(L).toBeGreaterThan(6);
      expect(L).toBeLessThan(24);
      expect(T).toBeGreaterThan(2);
      expect(T).toBeLessThan(4);
    }
  });

  it("la pente est la dérivée de la hauteur", () => {
    const e = 1e-3, x = 37.2, y = -14.9, t = 7.7, a = 0.3;
    const [gx, gy] = waveSlope(x, y, t, a);
    expect(gx).toBeCloseTo((waveHeight(x + e, y, t, a) - waveHeight(x - e, y, t, a)) / (2 * e), 5);
    expect(gy).toBeCloseTo((waveHeight(x, y + e, t, a) - waveHeight(x, y - e, t, a)) / (2 * e), 5);
  });

  it("le nuanceur fait le même calcul (mêmes constantes)", () => {
    for (const s of SWELL_TERMS) expect(WAVES_GLSL).toContain(String(s.k));
    expect(WAVES_GLSL).toContain("float waveHeight(vec2 p, float t)");
    expect(WAVES_GLSL).toContain("vec2 waveSlope(vec2 p, float t)");
  });
});
