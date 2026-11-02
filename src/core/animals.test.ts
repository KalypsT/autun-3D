import { describe, expect, it } from "vitest";
import { createCritter, CRITTER, FLOCK_CENTRE, inWaterPolys, presence, stepCritter } from "./animals";

const pond = [[[0, 0, 40, 0, 40, 40, 0, 40]]];
const wet = (x: number, y: number): boolean => inWaterPolys(pond, x, y);
const far = { x: 500, y: 500, speed: 0 };

describe("animaux (D203)", () => {
  it("à chacun son heure et sa saison", () => {
    expect(presence("cat", 14, 0, 1)).toBe(0);
    expect(presence("cat", 23, 1, 1)).toBe(1);
    expect(presence("swift", 19, 0.1, 1)).toBe(1);
    expect(presence("swift", 19, 0.1, 3)).toBe(0);
    expect(presence("bat", 21.5, 0.6, 1)).toBe(1);
    expect(presence("bat", 21.5, 0.6, 3)).toBe(0);
    expect(presence("dog", 22, 1, 1)).toBe(0);
  });

  it("un chien seul flâne, puis s'arrête et aboie quand le joueur passe tout près", () => {
    const d = createCritter("dog", 0, 0, 7);
    let moved = 0;
    for (let k = 0; k < 60 * 30; k++) {
      const px = d.x, py = d.y;
      stepCritter(d, 1 / 60, far, wet, null);
      moved += Math.hypot(d.x - px, d.y - py);
    }
    expect(moved).toBeGreaterThan(5);
    let barks = 0;
    for (let k = 0; k < 60 * 10; k++) if (stepCritter(d, 1 / 60, { x: d.x + 3, y: d.y, speed: 1 }, wet, null) === "bark") barks++;
    expect(barks).toBeGreaterThanOrEqual(2);
    expect(d.speed).toBe(0);
  });

  it("un chat détale quand on approche ; un héron s'envole", () => {
    const c = createCritter("cat", 0, 0, 3);
    for (let k = 0; k < 60; k++) stepCritter(c, 1 / 60, { x: 3, y: 0, speed: 1 }, wet, null);
    expect(c.state).toBe(CRITTER.flee);
    expect(c.x).toBeLessThan(-3);
    const h = createCritter("heron", 0, 0, 5);
    let flap = false;
    for (let k = 0; k < 60 * 3; k++) if (stepCritter(h, 1 / 60, { x: 12, y: 0, speed: 1 }, wet, null) === "flap") flap = true;
    expect(flap).toBe(true);
    expect(h.z).toBeGreaterThan(5);
    expect(Math.hypot(h.x, h.y)).toBeGreaterThan(10);
  });

  it("les canards restent sur l'eau et suivent leur meneur", () => {
    const lead = createCritter("duck", 20, 20, 1, 1), f = createCritter("duck", 21, 20, 2, 1);
    for (let k = 0; k < 60 * 60; k++) {
      stepCritter(lead, 1 / 60, far, wet, lead);
      stepCritter(f, 1 / 60, far, wet, lead);
      expect(wet(lead.x, lead.y) && wet(f.x, f.y)).toBe(true);
    }
    expect(Math.hypot(lead.x - f.x, lead.y - f.y)).toBeLessThan(6);
  });

  it("les martinets tournent haut au-dessus de leur centre, les chauves-souris plus bas et plus serré", () => {
    for (const s of ["swift", "bat"] as const) {
      const b = createCritter(s, FLOCK_CENTRE.x, FLOCK_CENTRE.y, 11);
      let maxD = 0;
      for (let k = 0; k < 60 * 60; k++) {
        stepCritter(b, 1 / 60, far, wet, null);
        maxD = Math.max(maxD, Math.hypot(b.x - b.tx, b.y - b.ty));
      }
      expect(maxD).toBeLessThan(s === "swift" ? 90 : 40);
      expect(b.z).toBeGreaterThanOrEqual(s === "swift" ? 18 : 6);
    }
  });
});
