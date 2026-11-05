import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/types";
import { solveCamera } from "./camera-rig";
import { createPose, swimPitch, swimPose } from "./character-rig";
import { Colliders } from "./collision";
import { OFFICER_WADE, Officers, type Suspect } from "./officers";
import { createPlayer, HOIST, stepPlayer, SWIM_ENTER, SWIM_FAST, SWIM_SINK, type MoveInput, type PlayerState } from "./player";
import { waterDepth, WADE_DEPTH } from "./shore";
import { loadRealWorld } from "./testing";
import { Waters } from "./waters";

const DT = 1 / 60;
const EAST = Math.PI / 2, WEST = -Math.PI / 2;
const go = (run = false): MoveInput => ({ forward: 1, right: 0, run });
const run = (p: PlayerState, t: number, yaw: number, terrain: HeightField, input: MoveInput = go(), colliders = new Colliders()): void => {
  for (let i = 0; i < t / DT; i++) stepPlayer(p, input, yaw, DT, terrain, colliders);
};

/** Étang de 100 m à l'est de x = 0, surface à z = 0 ; `bank(x)` : relief (berge à l'ouest, fond à l'est). */
const pond = (bank: (x: number, y: number) => number, bridge?: { z: number; y0: number; y1: number }): HeightField => {
  const w = new Waters({ v: 1, pieces: [{ r: [[0, -50, 100, -50, 100, 50, 0, 50]], z: [0, 0, 0] }] });
  const on = (x: number, y: number, zHint?: number): boolean =>
    !!bridge && y > bridge.y0 && y < bridge.y1 && x > -10 && x < 60 && (zHint === undefined || zHint + 1.5 >= bridge.z);
  const ground: HeightField = { heightAt: (x, y) => bank(x, y), xMin: -500, xMax: 500, yMin: -500, yMax: 500 };
  return {
    heightAt: (x, y, zHint) => (on(x, y, zHint) ? Math.max(bridge!.z, bank(x, y)) : bank(x, y)),
    ground, xMin: -500, xMax: 500, yMin: -500, yMax: 500,
    waterAt: (x, y) => w.levelAt(x, y),
  };
};
/** Berge en pente douce (0,2 m par mètre) jusqu'à 3 m de fond. */
const slope = pond((x) => (x < 0 ? 0.3 : Math.max(-3, 0.3 - 0.2 * x)));
/** Quai vertical à x = 0, de `edge` m au-dessus de l'eau, puis 3 m de fond. */
const quay = (edge: number): HeightField => pond((x) => (x < 0 ? edge : -3));

describe("nage dans l'eau de la ville (D241)", () => {
  it("on perd pied puis on nage, à la surface, sans dépasser la vitesse du crawl", () => {
    const p = createPlayer(-5, 0, slope, EAST);
    run(p, 12, EAST, slope, go(true));
    expect(p.swim).toBe(true);
    expect(p.z).toBeCloseTo(-SWIM_SINK, 1);
    expect(p.speed).toBeLessThanOrEqual(SWIM_FAST + 1e-6);
    expect(p.x).toBeGreaterThan(20);
    expect(p.air).toBe(false);
  });

  it("on ne saute pas à la nage", () => {
    const p = createPlayer(30, 0, slope, EAST);
    expect(p.swim).toBe(true);
    stepPlayer(p, { forward: 0, right: 0, run: false, jump: true }, EAST, DT, slope, new Colliders());
    expect(p.air).toBe(false);
    expect(p.swim).toBe(true);
  });

  it("on sort par une berge en pente : on se remet debout en marchant", () => {
    const p = createPlayer(30, 0, slope, WEST);
    run(p, 30, WEST, slope);
    expect(p.swim).toBe(false);
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeCloseTo(0.3, 1);
  });

  it("on se hisse sur un bord bas, on longe un bord haut sans sortir", () => {
    const low = quay(0.6), high = quay(HOIST + 0.6);
    const a = createPlayer(5, 0, low, WEST);
    run(a, 6, WEST, low);
    expect(a.swim).toBe(false);
    expect(a.x).toBeLessThan(0);
    expect(a.z).toBeCloseTo(0.6, 1);
    const b = createPlayer(5, 0, high, WEST);
    run(b, 6, WEST, high);
    expect(b.swim).toBe(true);
    expect(b.x).toBeGreaterThan(0);
  });

  it("on nage sous un pont haut ; d'un pont, on plonge sans se blesser", () => {
    const t = pond((x) => (x < 0 ? 0.3 : -3), { z: 3, y0: -3, y1: 3 });
    const p = createPlayer(10, -10, t, 0);
    run(p, 12, 0, t);
    expect(p.swim).toBe(true);
    expect(p.y).toBeGreaterThan(3);
    expect(p.z).toBeLessThan(0);
    // Sauter du tablier (3 m au-dessus de l'eau) : on tombe dans l'eau et on nage, sans chute qui compte.
    const q = createPlayer(10, 0, t, 0);
    expect(q.z).toBe(3);
    run(q, 1.5, 0, t, go(true));
    expect(q.swim).toBe(true);
    expect(q.landed).toBe(0);
  });

  it("depuis l'eau, on se hisse sur une passerelle au ras de l'eau", () => {
    const t = pond((x) => (x < 0 ? 0.3 : -3), { z: 0.34, y0: -1.5, y1: 1.5 });
    const p = createPlayer(10, -8, t, 0);
    let onDeck = false;
    for (let i = 0; i < 10 / DT; i++) {
      stepPlayer(p, go(), 0, DT, t, new Colliders());
      if (!p.swim && !p.climb && !p.air && Math.abs(p.z - 0.34) < 0.02 && Math.abs(p.y) < 1.5) onDeck = true;
    }
    expect(onDeck).toBe(true);
    // Tout droit, on traverse la passerelle et on retombe à l'eau de l'autre côté.
    expect(p.swim).toBe(true);
    expect(p.y).toBeGreaterThan(1.5);
  });

  it("la mer reste une limite : on n'y nage pas (D105)", () => {
    const beach: HeightField = { heightAt: (x) => (x < 0 ? 0.5 : 0.5 - 0.1 * x), xMin: -500, xMax: 500, yMin: -500, yMax: 500, seaLevel: 0 };
    const p = createPlayer(0, 0, beach, EAST);
    run(p, 30, EAST, beach, go(true));
    expect(p.swim).toBe(false);
    expect(waterDepth(beach, p.x, p.y)).toBeLessThanOrEqual(WADE_DEPTH);
  });

  it("la pose de nage est finie, et le corps plus couché en nageant vite", () => {
    const pose = createPose();
    for (let ph = 0; ph < 7; ph += 0.3) {
      swimPose(pose, ph, ph / 7);
      for (const v of pose.angles) expect(Number.isFinite(v)).toBe(true);
    }
    expect(swimPitch(1.5)).toBeGreaterThan(swimPitch(0));
    expect(swimPitch(1.5)).toBeLessThan(Math.PI / 2);
  });

  it("la caméra ne passe pas sous l'eau", () => {
    const r = solveCamera({ x: 30, y: 0, z: -SWIM_SINK - 0.9, yaw: 0, pitch: -0.3, distance: 4 }, new Colliders(), slope);
    expect(r.z).toBeGreaterThanOrEqual(0.35 - 1e-6);
  });
});

describe("gendarmes et nageur (D241)", () => {
  const swimmer = (x: number): Suspect => ({ x, y: 0, vx: 0, vy: 0, vehicle: null, swimming: true });
  it("ils l'attendent au bord, sans tirer et sans l'arrêter", () => {
    const depth = (x: number, y: number): number => waterDepth(slope, x, y);
    const o = new Officers(null, null, depth);
    o.spawn(-15, 0, EAST, 1, 7);
    let shots = 0;
    for (let i = 0; i < 60 * 20; i++) {
      o.step(DT, swimmer(25), () => null, true);
      shots += o.shots.length;
      o.clearShots();
    }
    expect(shots).toBe(0);
    expect(o.arrested).toBe(false);
    const g = o.list[0]!;
    expect(depth(g.x, g.y)).toBeLessThanOrEqual(OFFICER_WADE + 0.2);
    expect(g.x).toBeGreaterThan(0);
  });
});

describe("nage : données publiées (D241)", () => {
  const { terrain } = loadRealWorld();
  it("de la berge nord du Vallon, on entre dans le lac à la nage, puis on en ressort", () => {
    const p = createPlayer(1200, 650, terrain, Math.PI);
    run(p, 20, Math.PI, terrain);
    expect(p.swim).toBe(true);
    expect(p.y).toBeLessThan(625);
    expect(terrain.waterAt(p.x, p.y)! - p.z).toBeCloseTo(SWIM_SINK, 1);
    run(p, 40, 0, terrain);
    expect(p.swim).toBe(false);
    expect(terrain.waterAt(p.x, p.y) === undefined || terrain.waterAt(p.x, p.y)! - p.z < SWIM_ENTER).toBe(true);
  });
});
