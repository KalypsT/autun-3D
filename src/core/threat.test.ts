import { describe, expect, it } from "vitest";
import { THREAT_LIFE, THREAT_MAX, Threats } from "./threat";

describe("indicateur de tir reçu (D208)", () => {
  it("un arc tourné vers le tireur, à l'écran selon le regard ; plus vif si la balle a porté", () => {
    const t = new Threats();
    t.add(10, 0, 0, 0, true);
    expect(t.list).toHaveLength(1);
    expect(t.list[0]!.bearing).toBeCloseTo(Math.PI / 2, 9);
    // Regard au nord : le tireur à l'est est à droite (90°) ; regard à l'est : droit devant.
    expect(Threats.screenAngle(t.list[0]!, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(Threats.screenAngle(t.list[0]!, Math.PI / 2)).toBeCloseTo(0, 9);
    t.add(0, -10, 0, 0, false);
    expect(Threats.alpha(t.list[1]!)).toBeLessThan(Threats.alpha(t.list[0]!));
  });

  it("les tirs d'une même direction ravivent le même arc ; il s'éteint ; quatre arcs au plus", () => {
    const t = new Threats();
    t.add(10, 0, 0, 0, false);
    t.step(1);
    t.add(10, 1, 0, 0, false);
    expect(t.list).toHaveLength(1);
    expect(t.list[0]!.age).toBe(0);
    t.step(THREAT_LIFE / 2);
    expect(Threats.alpha(t.list[0]!)).toBeGreaterThan(0);
    t.step(THREAT_LIFE);
    expect(t.list).toHaveLength(0);
    for (let k = 0; k < 8; k++) {
      t.add(Math.sin(k) * 10, Math.cos(k) * 10, 0, 0, true);
      t.step(0.01);
    }
    expect(t.list.length).toBeLessThanOrEqual(THREAT_MAX);
  });
});
