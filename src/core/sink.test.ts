import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/types";
import { Colliders } from "./collision";
import { VehicleDamage } from "./damage";
import { BIKE_DEPTH, CAR_DEPTH } from "./shore";
import { BIKE, CAR, createVehicle, FLOAT_DRAFT, SINK_DEPTH, SINK_RATE, STALL_DEPTH, stepVehicle, type VehicleState } from "./vehicle";
import { Waters } from "./waters";

const DT = 1 / 60;
const EAST = Math.PI / 2;
const GAS = { throttle: 1, brake: 0, steer: 0 };

/** Eau de la ville à l'est de x = 0 (surface à z = 0) ; `bed(x)` : le fond. */
const water = (bed: (x: number) => number): HeightField => {
  const w = new Waters({ v: 1, pieces: [{ r: [[0, -50, 200, -50, 200, 50, 0, 50]], z: [0, 0, 0] }] });
  const ground: HeightField = { heightAt: (x) => (x < 0 ? 0.2 : bed(x)), xMin: -500, xMax: 500, yMin: -500, yMax: 500 };
  return { ...ground, ground, waterAt: (x, y) => w.levelAt(x, y) };
};
const drive = (s: VehicleState, spec: typeof CAR, t: number, terrain: HeightField, input = GAS): void => {
  for (let i = 0; i < t / DT; i++) stepVehicle(s, spec, input, DT, terrain, new Colliders(), null, true, true);
};

describe("véhicules dans l'eau de la ville (D242)", () => {
  it("un gué de 30 cm se passe, freiné, sans noyer le moteur", () => {
    const ford = water((x) => (x < 30 ? -0.3 : 0.2));
    const s = createVehicle(-20, 0, EAST, ford);
    drive(s, CAR, 20, ford);
    expect(s.x).toBeGreaterThan(30);
    expect(s.drowned).toBeFalsy();
    expect(s.sink).toBeFalsy();
  });

  it("entre 0,7 et 0,8 m, le moteur est noyé, sans couler", () => {
    const pool = water(() => -(STALL_DEPTH + SINK_DEPTH) / 2);
    const s = createVehicle(-10, 0, EAST, pool);
    drive(s, CAR, 6, pool);
    expect(s.x).toBeGreaterThan(0);
    expect(s.drowned).toBe(true);
    expect(s.sink).toBeFalsy();
    expect(CAR_DEPTH).toBeLessThan(STALL_DEPTH);
  });

  it("dans l'eau profonde, la voiture flotte, le nez plonge, puis elle coule jusqu'au fond sans choc", () => {
    const lake = water(() => -3);
    const s = createVehicle(-10, 0, EAST, lake);
    let floated = false, nose = 0;
    for (let i = 0; i < 20 / DT; i++) {
      // Le jeu coupe le moteur noyé (panne, `VehicleDamage.drown`) : ici, on lâche l'accélérateur.
      stepVehicle(s, CAR, s.drowned ? { throttle: 0, brake: 0, steer: 0 } : GAS, DT, lake, new Colliders(), null, true, true);
      if (s.sink && s.sink < 0.5 && Math.abs(s.z + FLOAT_DRAFT + SINK_RATE * s.sink) < 0.05) floated = true;
      if (s.sink && s.z > -2.9) nose = Math.min(nose, s.pitch);
      expect(s.impact).toBeLessThan(0.5);
      s.impact = 0;
    }
    expect(floated).toBe(true);
    expect(nose).toBeLessThan(-0.05);
    expect(s.drowned).toBe(true);
    expect(s.z).toBeCloseTo(-3, 1);
    // Il a dérivé un peu, puis s'est arrêté.
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(0.2);
  });

  it("à deux-roues, on tombe dès que l'eau passe la limite du deux-roues", () => {
    const lake = water(() => -1.5);
    const s = createVehicle(-10, 0, EAST, lake);
    let fell = false;
    for (let i = 0; i < 6 / DT && !fell; i++) {
      stepVehicle(s, BIKE, GAS, DT, lake, new Colliders(), null, true, true);
      fell = s.fallen;
    }
    expect(fell).toBe(true);
    expect(s.drowned).toBe(true);
    expect(s.sink).toBeFalsy();
    expect(BIKE_DEPTH).toBeLessThan(STALL_DEPTH);
  });

  it("noyé : une panne définitive, sans feu ni fumée", () => {
    const d = new VehicleDamage({ toughness: 1, burns: true });
    d.drown();
    expect(d.end).toBe("breakdown");
    expect(d.usable).toBe(false);
    expect(d.drowned).toBe(true);
    expect(d.burning).toBe(-1);
    expect(d.takeEvents().map((e) => e.kind)).toEqual(["breakdown"]);
    d.drown();
    expect(d.takeEvents()).toEqual([]);
    d.repair();
    expect(d.drowned).toBe(false);
    expect(d.usable).toBe(true);
  });
});
