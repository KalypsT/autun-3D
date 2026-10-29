import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/types";
import { Colliders } from "./collision";
import { createPlayer, stepPlayer } from "./player";
import { BIKE_DEPTH, CAR_DEPTH, holdShore, WADE_DEPTH, waterDepth } from "./shore";
import { BIKE, CAR, createVehicle, stepVehicle } from "./vehicle";

const DT = 1 / 60;

/** Plage vers l'est : le sol descend de 0,1 m par mètre au-delà de x = 0, la mer est à z = 0. */
const beach: HeightField = {
  heightAt: (x) => (x < 0 ? 0.5 : 0.5 - 0.1 * x),
  xMin: -500, xMax: 500, yMin: -500, yMax: 500,
  seaLevel: 0,
};

describe("mer autour du monde (D105)", () => {
  it("mesure la profondeur sur le relief, nulle à terre et sans mer", () => {
    expect(waterDepth(beach, -10, 0)).toBe(0);
    expect(waterDepth(beach, 15, 0)).toBeCloseTo(1.0, 6);
    expect(waterDepth({ ...beach, seaLevel: undefined }, 15, 0)).toBe(0);
  });

  it("glisse le long du rivage au lieu de s'arrêter net", () => {
    const r = holdShore(beach, 14, 0, 16, 3, WADE_DEPTH);
    expect(r.blocked).toBe(true);
    expect(r.x).toBe(14);
    expect(r.y).toBe(3);
  });

  it("à pied, on entre dans l'eau jusqu'à la taille, jamais plus loin", () => {
    const p = createPlayer(0, 0, beach, Math.PI / 2);
    for (let i = 0; i < 60 * 30; i++) stepPlayer(p, { forward: 1, right: 0, run: true }, Math.PI / 2, DT, beach, new Colliders());
    expect(waterDepth(beach, p.x, p.y)).toBeLessThanOrEqual(WADE_DEPTH);
    expect(p.x).toBeGreaterThan(14);
  });

  it("en voiture et à vélo, l'eau freine puis arrête au bord, sans choc", () => {
    for (const [spec, max] of [[CAR, CAR_DEPTH], [BIKE, BIKE_DEPTH]] as const) {
      const s = createVehicle(-60, 0, Math.PI / 2, beach);
      for (let i = 0; i < 60 * 20; i++) {
        stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 0 }, DT, beach, new Colliders());
        expect(waterDepth(beach, s.x, s.y)).toBeLessThanOrEqual(max + 1e-9);
      }
      expect(s.x).toBeGreaterThan(5);
      expect(s.fallen).toBe(false);
      expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1);
    }
  });
});
