import { describe, expect, it } from "vitest";
import { BASE_FOV, CameraShake, Haptics, speedFov, speedLines } from "./feel";

describe("champ de vision selon la vitesse", () => {
  it("au volant, il s'ouvre de plus en plus lentement : +6° à 50 km/h, +10° à 90, +15° à 200, jamais plus de +18°", () => {
    expect(speedFov(0, true)).toBe(BASE_FOV);
    expect(speedFov(50 / 3.6, true) - BASE_FOV).toBeCloseTo(6.3, 0);
    expect(speedFov(90 / 3.6, true) - BASE_FOV).toBeCloseTo(10.1, 0);
    expect(speedFov(200 / 3.6, true) - BASE_FOV).toBeCloseTo(15.2, 0);
    expect(speedFov(1000, true)).toBeLessThanOrEqual(BASE_FOV + 18);
    let prev = 0;
    for (let v = 0; v < 70; v += 1) {
      const f = speedFov(v, true);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    // Avant : 70° atteints dès 36 km/h, puis plus rien.
    expect(speedFov(150 / 3.6, true)).toBeGreaterThan(speedFov(90 / 3.6, true) + 2);
  });

  it("à pied, au plus +4° en courant", () => {
    expect(speedFov(1.4, false)).toBeCloseTo(BASE_FOV + 1.1, 1);
    expect(speedFov(5, false)).toBe(BASE_FOV + 4);
  });

  it("traits de vitesse : rien sous 100 km/h, pleins à 200", () => {
    expect(speedLines(90 / 3.6)).toBe(0);
    expect(speedLines(150 / 3.6)).toBeCloseTo(0.5);
    expect(speedLines(250 / 3.6)).toBe(1);
    expect(speedLines(-150 / 3.6)).toBeCloseTo(0.5);
  });
});

describe("tremblement de la caméra", () => {
  const amplitude = (s: CameraShake, speed: number, seconds: number): number => {
    let m = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      s.step(1 / 60, speed);
      m = Math.max(m, Math.hypot(s.offset.x, s.offset.y));
    }
    return m;
  };

  it("rien à l'arrêt ni en ville, un frémissement de quelques centimètres à grande vitesse", () => {
    expect(amplitude(new CameraShake(), 0, 2)).toBe(0);
    expect(amplitude(new CameraShake(), 30 / 3.6, 2)).toBe(0);
    const fast = amplitude(new CameraShake(), 200 / 3.6, 2);
    expect(fast).toBeGreaterThan(0.01);
    expect(fast).toBeLessThan(0.06);
  });

  it("un choc secoue, plus fort s'il est violent, et s'amortit en moins d'une demi-seconde", () => {
    const soft = new CameraShake(), hard = new CameraShake();
    soft.impact(2);
    hard.impact(15);
    expect(amplitude(hard, 0, 0.1)).toBeGreaterThan(amplitude(soft, 0, 0.1));
    const s = new CameraShake();
    s.impact(15);
    amplitude(s, 0, 0.5);
    expect(amplitude(s, 0, 0.1)).toBeLessThan(0.01);
  });
});

describe("vibrations", () => {
  const record = (): { calls: (number | number[])[]; h: Haptics } => {
    const calls: (number | number[])[] = [];
    return { calls, h: new Haptics((p) => calls.push(p)) };
  };

  it("un choc vibre selon sa violence ; un frôlement sous 1,2 m/s ne vibre pas", () => {
    const { calls, h } = record();
    h.crash(0.8);
    expect(calls).toEqual([]);
    h.crash(2);
    h.step(1);
    h.crash(20);
    expect(calls).toEqual([40, 140]);
  });

  it("pas plus d'une relance toutes les 60 ms, sauf pour une vibration plus forte", () => {
    const { calls, h } = record();
    h.shot("rifle");
    h.shot("rifle");
    expect(calls).toEqual([9]);
    h.step(0.07);
    h.shot("rifle");
    expect(calls).toEqual([9, 9]);
    h.hurt();
    expect(calls).toEqual([9, 9, 60]);
    h.shot("rifle");
    expect(calls.length).toBe(3);
  });

  it("coupées par le réglage, ou sans vibreur", () => {
    const { calls, h } = record();
    h.enabled = false;
    h.death();
    expect(calls).toEqual([]);
    expect(new Haptics(null).pulse(50)).toBe(false);
  });

  it("motifs : mort et arrestation", () => {
    const { calls, h } = record();
    h.death();
    h.step(1);
    h.arrest();
    expect(calls).toEqual([[90, 70, 180], [40, 60, 40]]);
  });
});
