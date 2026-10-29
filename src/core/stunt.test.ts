import { describe, expect, it } from "vitest";
import { STUNT_SHOW, StuntMeter } from "./stunt";

describe("compteur de roue arrière et de roue avant (D98)", () => {
  const DT = 1 / 60;

  it("compte la distance sur une roue, la montre encore un moment, et retient le record", () => {
    const m = new StuntMeter();
    for (let i = 0; i < 120; i++) m.update(0.4, 10, DT);
    expect(m.label()).toBe("Roue arrière 20 m");
    m.update(0, 10, DT);
    expect(m.label()).toBe("Roue arrière 20 m · record !");
    expect(m.best.wheelie).toBeCloseTo(20, 0);
    for (let i = 0; i < STUNT_SHOW * 60 + 2; i++) m.update(0, 10, DT);
    expect(m.label()).toBe("");
    // Une figure plus courte que le record ne l'annonce pas.
    for (let i = 0; i < 60; i++) m.update(0.4, 10, DT);
    m.update(0, 10, DT);
    expect(m.label()).toBe("Roue arrière 10 m");
  });

  it("une roue avant se compte à part ; un sursaut de moins de 3 m ne s'affiche pas", () => {
    const m = new StuntMeter();
    for (let i = 0; i < 6; i++) m.update(0.2, 10, DT);
    m.update(0, 10, DT);
    expect(m.label()).toBe("");
    for (let i = 0; i < 60; i++) m.update(-0.3, 8, DT);
    expect(m.label()).toBe("Roue avant 8 m");
    m.end();
    expect(m.best.stoppie).toBeCloseTo(8, 0);
    expect(m.best.wheelie).toBe(0);
  });
});
