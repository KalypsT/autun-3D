import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HeightField, TileData, TileKinds, VallonModel } from "../data/types";
import { HEDGE, STEP, vallonPoint, vallonPropCircles } from "../core/vallon-props";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildVallonProps } from "./vallon-props";
import { vallonFrame } from "./vallon";

/** D175 : cour et abords du collège du Vallon (lot 4 de docs/plans/college-vallon.md). */
const MAIN = "BATIMENT0000000348848973";
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
const tile = JSON.parse(readFileSync("public/data/tiles/28_39.json", "utf8")) as TileData;
const m = kinds.buildings[MAIN]!.vallon as VallonModel;
const g0 = -34.2;
const flat: HeightField = { heightAt: () => g0, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas: {} as SignAtlas });
const wing = (n: string) => m.wings!.find((w) => w.n === n)!;

const inside = (p: [number, number], ring: number[]): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if (ring[i + 1]! > p[1] !== ring[j + 1]! > p[1] && p[0] < ((ring[j]! - ring[i]!) * (p[1] - ring[i + 1]!)) / (ring[j + 1]! - ring[i + 1]!) + ring[i]!) c = !c;
  }
  return c;
};

describe("Abords du collège (D175) : données", () => {
  it("les marches sont face à la porte : à la même hauteur (v) que la porte du mur-rideau, contre la face ouest de l'aile ouest", () => {
    const steps = m.props!.find((p) => p.k === "steps")!;
    const aile = wing("aile-ouest");
    const door = m.faces!.find((q) => q.w === "aile-ouest" && q.f === "w")!.door![0]!;
    // La face ouest part de v1 et va vers v0 : s → v = v1 − s.
    expect(steps.v).toBeCloseTo(aile.r[3] - door, 0);
    expect(steps.u).toBeCloseTo(aile.r[0], 6);
    expect(steps.w!).toBeGreaterThan(4);
  });

  it("les abords sont à l'ouest de l'entrée : bacs et rochers au sud des marches, haie et bouleau au nord", () => {
    const steps = m.props!.find((p) => p.k === "steps")!;
    for (const p of m.props!) {
      if (p.k === "pot" || p.k === "rock") expect(p.v, p.k).toBeLessThan(steps.v - steps.w! / 2 + 0.5);
      if (p.k === "hedge" || p.k === "birch") expect(p.v, p.k).toBeGreaterThan(steps.v + steps.w! / 2 - 0.5);
      expect(p.u).toBeLessThanOrEqual(wing("aile-ouest").r[0]);
    }
    expect(m.props!.filter((p) => p.k === "pot")).toHaveLength(3);
    expect(m.props!.filter((p) => p.k === "rock").length).toBeGreaterThanOrEqual(3);
  });

  it("aucun obstacle ne mord sur le mur-rideau : tous restent à l'ouest du pied de la façade", () => {
    const u0 = wing("aile-ouest").r[0];
    const c = vallonPropCircles(m);
    expect(c.length).toBeGreaterThan(10);
    const f = vallonFrame(m);
    for (const [x, y, r] of c) {
      const [u] = f.uv([x, y]);
      expect(u + r, `(${x}, ${y})`).toBeLessThan(u0 - 0.05);
    }
    expect(HEDGE.width).toBeGreaterThan(0.5);
  });

  it("la porte reste dégagée : aucun obstacle dans le couloir de 3 m dans l'axe des marches", () => {
    const steps = m.props!.find((p) => p.k === "steps")!, f = vallonFrame(m);
    for (const [x, y, r] of vallonPropCircles(m)) {
      const [, v] = f.uv([x, y]);
      expect(Math.abs(v - steps.v) - r, `(${x}, ${y})`).toBeGreaterThan(1.5);
    }
  });

  it("le point (u, v) du jeu de données et celui du rendu coïncident", () => {
    const f = vallonFrame(m);
    expect(vallonPoint(m, -9, 2)).toEqual(f.pt(-9, 2));
  });
});

describe("Cour du collège (D175) : sols", () => {
  const asphalt = (tile.ground.plaza_asphalt as number[][][]).map((p) => p[0]!);

  it("la cour est, la cour ouest, la cour nord et l'accès de la grille ont un enrobé (ils étaient sans sol)", () => {
    for (const p of [[675, 1130], [596, 1120], [625, 1158], [570, 1109]] as [number, number][]) {
      expect(asphalt.some((r) => inside(p, r)), `(${p})`).toBe(true);
    }
  });

  it("aucun enrobé dans l'emprise des bâtiments, ni sur la pelouse à l'ouest de l'accès ni sur le pont", () => {
    for (const b of tile.buildings.filter((x) => ["BATIMENT0000000348848973", "BATIMENT0000000348849004", "BATIMENT0000000348848974"].includes(x.id))) {
      const [cx, cy] = [b.ring.filter((_, i) => i % 2 === 0), b.ring.filter((_, i) => i % 2 === 1)].map((a) => a.reduce((s, v) => s + v, 0) / a.length) as [number, number];
      if (!inside([cx, cy], b.ring)) continue;
      expect(asphalt.some((r) => inside([cx, cy], r)), b.id).toBe(false);
    }
    expect(asphalt.some((r) => inside([570, 1130], r))).toBe(false);
    expect(asphalt.some((r) => inside([535, 1078], r))).toBe(false);
  });
});

describe("Abords du collège (D175) : maillage", () => {
  it("marches, bacs, rochers, haie et bouleau : maillage fini, plus de 150 et moins de 2 000 triangles", () => {
    const s = sinks();
    buildVallonProps(s, m, flat);
    expect(s.solid.triangleCount).toBeGreaterThan(150);
    expect(s.solid.triangleCount).toBeLessThan(2000);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
  });

  it("le palier des marches est à trois fois la hauteur d'une marche au-dessus du sol, et rien ne dépasse le bouleau", () => {
    const s = sinks();
    buildVallonProps(s, m, flat);
    const ys = s.solid.positions.filter((_, i) => i % 3 === 1);
    const birch = m.props!.find((p) => p.k === "birch")!;
    expect(Math.max(...ys)).toBeCloseTo(g0 - 0.1 + birch.h!, 3);
    const landing = g0 + STEP.rise * STEP.count;
    expect(ys.some((y) => Math.abs(y - landing) < 1e-6)).toBe(true);
  });
});
