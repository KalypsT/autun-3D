import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { createPlayer, RUN_SPEED, stepPlayer, WALK_SPEED } from "./player";
import { flatTerrain } from "./testing";

const DT = 1 / 60;
const terrain = flatTerrain();

function run(frames: number, fn: () => void): void {
  for (let i = 0; i < frames; i++) fn();
}

describe("stepPlayer", () => {
  it("accélère jusqu'à la vitesse de marche, pas au-delà", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 1, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(WALK_SPEED, 1);
    expect(p.y).toBeGreaterThan(2);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
  });

  it("court plus vite que la marche", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(RUN_SPEED, 1);
  });

  it("une demi-poussée donne une demi-vitesse", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 0.5, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(WALK_SPEED / 2, 1);
  });

  it("s'arrête quand on lâche", () => {
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    run(60, () => stepPlayer(p, { forward: 0, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeLessThan(0.01);
  });

  it("avance dans la direction de la caméra", () => {
    const p = createPlayer(0, 0, terrain);
    // Caméra tournée vers l'est (yaw 90°) : « avant » = +x.
    run(60, () => stepPlayer(p, { forward: 1, right: 0, run: false }, Math.PI / 2, DT, terrain, new Colliders()));
    expect(p.x).toBeGreaterThan(1);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
    expect(p.heading).toBeGreaterThan(1.2);
  });

  it("droite = à droite de la caméra", () => {
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, { forward: 0, right: 1, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.x).toBeGreaterThan(1);
  });

  it("est arrêté par un mur", () => {
    const c = new Colliders();
    c.addSegment(5, -20, 5, 20);
    const p = createPlayer(0, 0, terrain);
    run(600, () => stepPlayer(p, { forward: 0, right: 1, run: true }, 0, DT, terrain, c));
    expect(p.x).toBeLessThanOrEqual(5 - 0.35 + 1e-3);
    expect(p.x).toBeGreaterThan(4.5);
  });

  it("glisse le long d'un mur en biais", () => {
    const c = new Colliders();
    c.addSegment(5, -50, 5, 50);
    const p = createPlayer(0, 0, terrain);
    // Direction nord-est : le mur retient l'est, le nord continue.
    run(240, () => stepPlayer(p, { forward: 1, right: 1, run: true }, 0, DT, terrain, c));
    expect(p.x).toBeLessThanOrEqual(5);
    expect(p.y).toBeGreaterThan(10);
  });

  it("suit le relief", () => {
    const hill = flatTerrain(3);
    const p = createPlayer(0, 0, hill);
    expect(p.z).toBeCloseTo(3);
  });

  it("ne sort pas du monde", () => {
    const p = createPlayer(0, 0, terrain);
    run(3000, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    expect(p.y).toBeLessThanOrEqual(terrain.yMax - 3 + 1e-6);
  });
});
