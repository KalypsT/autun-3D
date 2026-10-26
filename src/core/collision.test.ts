import { describe, expect, it } from "vitest";
import { Colliders, pointInRing } from "./collision";

describe("Colliders.resolve", () => {
  it("repousse un cercle qui pénètre un mur", () => {
    const c = new Colliders();
    c.addSegment(5, -10, 5, 10);
    const r = c.resolve(4.9, 0, 0.35);
    expect(r.hit).toBe(true);
    expect(r.x).toBeLessThan(4.66);
    expect(r.nx).toBeCloseTo(-1);
  });

  it("ne touche à rien loin des obstacles", () => {
    const c = new Colliders();
    c.addSegment(5, -10, 5, 10);
    const r = c.resolve(0, 0, 0.35);
    expect(r).toMatchObject({ x: 0, y: 0, hit: false });
  });

  it("gère les coins : deux murs perpendiculaires", () => {
    const c = new Colliders();
    c.addSegment(5, -10, 5, 10);
    c.addSegment(-10, 5, 10, 5);
    const r = c.resolve(4.9, 4.9, 0.35);
    expect(r.x).toBeLessThan(4.66);
    expect(r.y).toBeLessThan(4.66);
  });

  it("repousse hors d'un cercle (mobilier)", () => {
    const c = new Colliders();
    c.addCircle(0, 0, 0.5);
    const r = c.resolve(0.3, 0, 0.35);
    expect(Math.hypot(r.x, r.y)).toBeGreaterThanOrEqual(0.85 - 1e-3);
  });

  it("sort un cercle centré exactement sur un segment", () => {
    const c = new Colliders();
    c.addSegment(-1, 0, 1, 0);
    const r = c.resolve(0, 0, 0.35);
    expect(Math.abs(r.y)).toBeGreaterThanOrEqual(0.35);
  });

  it("anneau fermé : l'intérieur est protégé par le contour", () => {
    const c = new Colliders();
    c.addRing([0, 0, 10, 0, 10, 10, 0, 10]);
    expect(c.resolve(-0.2, 5, 0.35).x).toBeLessThan(-0.34);
    expect(c.resolve(10.2, 5, 0.35).x).toBeGreaterThan(10.34);
  });
});

describe("Colliders.raycast", () => {
  it("rend la fraction du premier mur touché", () => {
    const c = new Colliders();
    c.addSegment(5, -10, 5, 10);
    c.addSegment(8, -10, 8, 10);
    expect(c.raycast(0, 0, 10, 0)).toBeCloseTo(0.5);
  });

  it("rend null quand rien n'est coupé", () => {
    const c = new Colliders();
    c.addSegment(5, 1, 5, 10);
    expect(c.raycast(0, 0, 10, 0)).toBeNull();
  });

  it("ignore les cercles (mobilier)", () => {
    const c = new Colliders();
    c.addCircle(5, 0, 1);
    expect(c.raycast(0, 0, 10, 0)).toBeNull();
  });
});

describe("pointInRing", () => {
  const square = [0, 0, 4, 0, 4, 4, 0, 4];
  it("distingue dedans et dehors", () => {
    expect(pointInRing(2, 2, square)).toBe(true);
    expect(pointInRing(5, 2, square)).toBe(false);
  });
});
