import { describe, expect, it } from "vitest";
import { solveCamera } from "./camera-rig";
import { Colliders } from "./collision";
import { flatTerrain } from "./testing";

const terrain = flatTerrain();
const base = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.3, distance: 4 };

describe("solveCamera", () => {
  it("se place derrière le joueur, à la distance demandée", () => {
    const r = solveCamera(base, new Colliders(), terrain);
    expect(r.y).toBeLessThan(0); // regard vers le nord : caméra au sud
    expect(r.z).toBeGreaterThan(1.55);
    expect(r.distance).toBeCloseTo(4, 1);
  });

  it("se rapproche quand un mur est derrière", () => {
    const c = new Colliders();
    c.addSegment(-20, -2, 20, -2);
    const r = solveCamera(base, c, terrain);
    expect(r.y).toBeGreaterThan(-2);
    expect(r.distance).toBeLessThan(2.2);
  });

  it("ne passe jamais sous le sol", () => {
    const r = solveCamera({ ...base, pitch: -1.2 }, new Colliders(), terrain);
    expect(r.z).toBeGreaterThanOrEqual(0.35 - 1e-9);
  });

  it("garde une distance minimale contre un mur collé", () => {
    const c = new Colliders();
    c.addSegment(-20, -0.2, 20, -0.2);
    const r = solveCamera(base, c, terrain);
    expect(r.distance).toBeGreaterThanOrEqual(0.5);
  });
});
