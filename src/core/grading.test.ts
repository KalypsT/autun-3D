import { describe, expect, it } from "vitest";
import { applyGrade, gradeAt, NEUTRAL_GRADE } from "./grading";

const warmth = (rgb: readonly number[]): number => rgb[0]! - rgb[2]!;
const MID: [number, number, number] = [0.3, 0.3, 0.3];

describe("étalonnage selon l'heure (D314)", () => {
  it("le neutre ne change rien ; le noir et le blanc restent en place, même avec du contraste", () => {
    for (const c of [[0, 0, 0], [0.2, 0.5, 0.8], [1, 1, 1]] as [number, number, number][]) {
      const out = applyGrade(NEUTRAL_GRADE, c);
      out.forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 5));
    }
    const noon = gradeAt(60, false);
    expect(applyGrade(noon, [1, 1, 1]).every((v) => v > 0.99)).toBe(true);
    expect(applyGrade(noon, [0, 0, 0]).every((v) => v < 0.01)).toBe(true);
  });

  it("midi franc : plus de contraste qu'au matin ; le matin est plus doux que le soir à la même hauteur de soleil", () => {
    expect(gradeAt(50, false).contrast).toBeGreaterThan(1.05);
    expect(gradeAt(10, true).contrast).toBeLessThan(1);
    expect(gradeAt(5, true).saturation).toBeLessThan(gradeAt(5, false).saturation);
  });

  it("coucher chaud, nuit bleutée", () => {
    expect(warmth(applyGrade(gradeAt(3, false), MID))).toBeGreaterThan(0.02);
    expect(warmth(applyGrade(gradeAt(-15, false), [0.05, 0.05, 0.05]))).toBeLessThan(-0.005);
    // La nuit, les lumières (claires) restent chaudes.
    expect(warmth(applyGrade(gradeAt(-15, false), [0.9, 0.8, 0.6]))).toBeGreaterThan(0.15);
  });

  it("pas de saut d'un jalon à l'autre, ni entre le matin et le soir aux deux bouts", () => {
    for (const morning of [true, false]) {
      let prev = gradeAt(-20, morning);
      for (let e = -20; e <= 60; e += 0.5) {
        const cur = gradeAt(e, morning);
        expect(Math.abs(cur.contrast - prev.contrast)).toBeLessThan(0.02);
        expect(Math.abs(cur.gain[2] - prev.gain[2])).toBeLessThan(0.02);
        prev = cur;
      }
    }
    expect(gradeAt(-12, true)).toEqual(gradeAt(-12, false));
    expect(gradeAt(45, true)).toEqual(gradeAt(45, false));
  });

  it("par temps couvert, on revient vers le neutre", () => {
    const clear = gradeAt(3, false, 0), grey = gradeAt(3, false, 1);
    expect(Math.abs(grey.gain[2] - 1)).toBeLessThan(Math.abs(clear.gain[2] - 1));
    expect(Math.abs(grey.saturation - 1)).toBeLessThan(Math.abs(clear.saturation - 1));
  });
});
