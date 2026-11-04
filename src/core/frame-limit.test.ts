import { describe, expect, it } from "vitest";
import { FrameLimiter } from "./frame-limit";

/** Nombre d'images dessinées en `seconds` secondes sur un écran à `hz` Hz, avec une limite de `fps`. */
function drawn(hz: number, fps: number, seconds = 10, jitter = 0): number {
  const limiter = new FrameLimiter();
  let n = 0;
  for (let i = 0; i < hz * seconds; i++) {
    const t = (i * 1000) / hz + (jitter ? Math.sin(i * 12.9898) * jitter : 0);
    if (limiter.ready(t, fps)) n++;
  }
  return n / seconds;
}

describe("FrameLimiter", () => {
  it("ramène un écran à 120 Hz à 60 images par seconde", () => {
    expect(drawn(120, 60)).toBeCloseTo(60, 0);
  });

  it("garde la cadence moyenne demandée sur un écran à 90 ou 144 Hz", () => {
    expect(Math.abs(drawn(90, 60) - 60)).toBeLessThan(1);
    expect(Math.abs(drawn(144, 60) - 60)).toBeLessThan(1);
    expect(Math.abs(drawn(120, 30) - 30)).toBeLessThan(1);
  });

  it("ne perd pas d'image sur un écran à 60 Hz, même avec des horodatages irréguliers", () => {
    expect(drawn(60, 60, 10, 0.8)).toBe(60);
  });

  it("sans limite, dessine chaque image", () => {
    expect(drawn(120, 0)).toBe(120);
  });

  it("repart sans rafale après une longue image", () => {
    const limiter = new FrameLimiter();
    expect(limiter.ready(0, 60)).toBe(true);
    expect(limiter.ready(500, 60)).toBe(true);
    // Pas de rattrapage : l'image suivante attend un intervalle complet.
    expect(limiter.ready(508.3, 60)).toBe(false);
    expect(limiter.ready(516.7, 60)).toBe(true);
  });
});
