import { describe, expect, it } from "vitest";
import { Colliders, pointInRing } from "./collision";

describe("Colliders.removeTag", () => {
  function load(c: Colliders, tag: string, x: number): void {
    c.currentTag = tag;
    c.addSegment(x, -10, x, 10);
    c.addCircle(x + 3, 0, 0.5);
    c.currentTag = null;
  }

  it("retire les obstacles d'une tuile, et eux seuls", () => {
    const c = new Colliders();
    load(c, "a", 5);
    load(c, "b", 50);
    expect(c.resolve(4.9, 0, 0.35).hit).toBe(true);
    c.removeTag("a");
    expect(c.resolve(4.9, 0, 0.35).hit).toBe(false);
    expect(c.resolve(8, 0, 0.35).hit).toBe(false);
    expect(c.resolve(49.9, 0, 0.35).hit).toBe(true);
    expect(c.raycast(0, 0, 10, 0)).toBeNull();
    expect(c.raycast(40, 0, 60, 0)).not.toBeNull();
  });

  it("réutilise les emplacements libérés : charger et décharger sans fin ne fait pas grossir la mémoire", () => {
    const c = new Colliders();
    load(c, "a", 5);
    const size = c.segments.length;
    for (let i = 0; i < 200; i++) {
      c.removeTag("a");
      load(c, "a", 5);
    }
    expect(c.segments.length).toBe(size);
    expect(c.live).toEqual({ segments: 1, circles: 1 });
    expect(c.resolve(4.9, 0, 0.35).hit).toBe(true);
  });
});

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

describe("rayons et obstacles ronds (D113)", () => {
  it("par défaut, un rayon traverse les cercles ; avec `circles`, il s'arrête à l'entrée du premier ; un départ dans un cercle ne compte pas", () => {
    const c = new Colliders();
    c.addCircle(5, 0, 1);
    c.addCircle(9, 0, 1);
    expect(c.raycast(0, 0, 20, 0)).toBeNull();
    expect(c.raycast(0, 0, 20, 0, true)).toBeCloseTo(4 / 20, 6);
    expect(c.raycast(0, 3, 20, 3, true)).toBeNull();
    expect(c.raycast(5, 0, 5.5, 0, true)).toBeNull();
  });
});
