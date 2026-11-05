import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/types";
import { waterPieceTriangles } from "../render/inland-water";
import { planeField } from "../render/structures";
import { Colliders } from "./collision";
import { createPlayer, stepPlayer } from "./player";
import { CAR_DEPTH, hasWater, holdShore, WADE_DEPTH, waterDepth } from "./shore";
import { loadRealWorld } from "./testing";
import { CAR, createVehicle, stepVehicle } from "./vehicle";
import { Waters } from "./waters";

const DT = 1 / 60;
/** Carré de 100 m (de 0 à 100), avec un trou de 10 m au milieu (une île), surface à z = 0. */
const SQUARE = [0, 0, 100, 0, 100, 100, 0, 100];
const HOLE = [45, 45, 55, 45, 55, 55, 45, 55];

/** Étang à l'est de x = 0 : la berge descend de 0,2 m par mètre jusqu'à 3 m de fond ; un pont à z = 1 enjambe l'eau entre y = −2 et y = 2. */
const pond = new Waters({ v: 1, pieces: [{ r: [[0, -50, 100, -50, 100, 50, 0, 50]], z: [0, 0, 0] }] });
const bed = (x: number): number => (x < 0 ? 0.3 : Math.max(-3, -0.2 * x));
const onBridge = (x: number, y: number): boolean => Math.abs(y) < 2 && x > -5 && x < 60;
const lake: HeightField = {
  heightAt: (x, y, zHint) => (onBridge(x, y) && (zHint === undefined || zHint > 0.5) ? 1 : bed(x)),
  ground: { heightAt: (x) => bed(x), xMin: -500, xMax: 500, yMin: -500, yMax: 500 },
  xMin: -500, xMax: 500, yMin: -500, yMax: 500,
  waterAt: (x, y) => pond.levelAt(x, y),
};

describe("eau de la ville : registre (D240)", () => {
  it("donne le niveau dans un morceau, rien dehors ni dans un trou", () => {
    const w = new Waters({ v: 1, pieces: [{ r: [SQUARE, HOLE], z: [0, 0, -25.4] }] });
    expect(w.levelAt(10, 10)).toBeCloseTo(-25.4, 6);
    expect(w.levelAt(99.9, 0.1)).toBeCloseTo(-25.4, 6);
    expect(w.levelAt(-1, 10)).toBeUndefined();
    expect(w.levelAt(50, 50)).toBeUndefined();
    expect(w.levelAt(500, 500)).toBeUndefined();
    expect(new Waters(null).empty).toBe(true);
  });

  it("suit le plan d'une rivière, z = a·x + b·y + c", () => {
    const w = new Waters({ v: 1, pieces: [{ r: [SQUARE], z: [0.001, -0.002, -40] }] });
    expect(w.levelAt(80, 30)).toBeCloseTo(-40 + 0.08 - 0.06, 6);
  });

  it("dessine l'eau lointaine à plat, juste sous la surface des tuiles détaillées", () => {
    const tri = waterPieceTriangles([SQUARE, HOLE], () => -25.4);
    expect(tri.length % 9).toBe(0);
    expect(tri.length / 9).toBe(8);
    for (let i = 1; i < tri.length; i += 3) expect(tri[i]).toBeCloseTo(-25.44, 6);
    expect(planeField([0, 0, -25.4], lake).heightAt(12, 34)).toBe(-25.4);
  });
});

describe("eau de la ville : profondeur et berges (D240)", () => {
  it("mesure la profondeur sous la surface où l'on se tient", () => {
    expect(hasWater(lake)).toBe(true);
    expect(waterDepth(lake, -10, 20)).toBe(0);
    expect(waterDepth(lake, 5, 20)).toBeCloseTo(1, 6);
    expect(waterDepth(lake, 50, 20)).toBeCloseTo(3, 6);
    // Sur le pont, la profondeur est nulle ; dans l'eau sous le pont, c'est celle du fond.
    expect(waterDepth(lake, 30, 0, 1)).toBe(0);
    expect(waterDepth(lake, 30, 0, -3)).toBeCloseTo(3, 6);
  });

  it("à pied, on entre dans l'eau, puis on nage (D241) ; sur le pont, on passe", () => {
    const p = createPlayer(-10, 20, lake, Math.PI / 2);
    for (let i = 0; i < 60 * 20; i++) stepPlayer(p, { forward: 1, right: 0, run: true }, Math.PI / 2, DT, lake, new Colliders());
    expect(p.swim).toBe(true);
    expect(p.x).toBeGreaterThan(20);
    expect(holdShore(lake, 29, 0, 30, 0, WADE_DEPTH, 1).blocked).toBe(false);
  });

  it("en voiture, l'eau freine, puis on y entre et l'on coule (D242)", () => {
    const s = createVehicle(-40, 20, Math.PI / 2, lake);
    for (let i = 0; i < 60 * 12; i++) stepVehicle(s, CAR, { throttle: 1, brake: 0, steer: 0 }, DT, lake, new Colliders());
    expect(s.x).toBeGreaterThan(1);
    expect(s.drowned).toBe(true);
    expect(waterDepth(lake, s.x, s.y)).toBeGreaterThan(CAR_DEPTH);
  });
});

describe("eau de la ville : données publiées (D240)", () => {
  const { terrain } = loadRealWorld();

  it("le plan d'eau du Vallon a un seul niveau et un fond creusé", () => {
    const z = terrain.waterAt(1245, 360)!;
    expect(z).toBeCloseTo(-25.41, 1);
    expect(terrain.waterAt(1400, 120)).toBeCloseTo(z, 6);
    const depth = z - terrain.groundAt(1245, 360);
    expect(depth).toBeGreaterThan(2.5);
    expect(depth).toBeLessThan(5.2);
    // La queue sud est un marais : on y a pied.
    expect(z - terrain.groundAt(1300, 90)).toBeLessThan(0.5);
    // La berge nord : on a pied à 2 m du bord, plus à 10 m.
    expect(waterDepth(terrain, 1200, 653)).toBeLessThan(WADE_DEPTH);
    expect(waterDepth(terrain, 1200, 630)).toBeGreaterThan(WADE_DEPTH);
  });

  it("l'Arroux est de l'eau de la ville, sous ses ponts on n'est pas bloqué sur le tablier", () => {
    const z = terrain.waterAt(-103, 1364);
    expect(z).toBeDefined();
    expect(z!).toBeGreaterThan(-43);
    expect(z!).toBeLessThan(-40);
    // Pont routier 80220457 sur l'Arroux : sur son tablier, la profondeur est nulle.
    let found = 0;
    for (let x = -800; x < 300 && !found; x += 2) {
      for (let y = 1000; y < 2600 && !found; y += 2) {
        const w = terrain.waterAt(x, y);
        if (w === undefined) continue;
        const deck = terrain.heightAt(x, y);
        if (deck - w > 2.5 && w - terrain.groundAt(x, y) > 1) {
          expect(waterDepth(terrain, x, y, deck)).toBe(0);
          expect(waterDepth(terrain, x, y, terrain.groundAt(x, y))).toBeGreaterThan(1);
          found++;
        }
      }
    }
    expect(found).toBe(1);
  });

  it("la mer garde sa règle (D105), sans eau de la ville au large", () => {
    expect(terrain.seaLevel).toBeCloseTo(-47.5, 6);
    expect(terrain.waterAt(-6000, -8000)).toBeUndefined();
  });
});
