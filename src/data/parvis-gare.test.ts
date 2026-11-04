import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStalls } from "../core/parking";
import type { StationModel, TileData, TileKinds } from "./types";

/** D230 : le parvis de la gare : places de l'est et de l'abri de parking, allée pavée, gravier, quai et zigzag de la gare routière. */
const tile = JSON.parse(readFileSync("public/data/tiles/24_37.json", "utf8")) as TileData;
const sta = (JSON.parse(readFileSync("public/data/kinds/24_37.json", "utf8")) as TileKinds).buildings["BATIMENT0000000348856379"]!.sta as StationModel;
const st = (x: number, y: number): [number, number] => {
  const dx = x - sta.o[0], dy = y - sta.o[1], c = Math.cos(sta.a), s = Math.sin(sta.a);
  return [dx * c + dy * s, -dx * s + dy * c];
};
const centre = (p: readonly (readonly number[])[]): [number, number] => {
  const r = p[0]!;
  let x = 0, y = 0;
  for (let i = 0; i < r.length; i += 2) [x, y] = [x + r[i]!, y + r[i + 1]!];
  return [(2 * x) / r.length, (2 * y) / r.length];
};
const inParvis = ([s, t]: [number, number]): boolean => s > -45 && s < 78 && t < 0.6 && t > -40.3;

describe("parvis de la gare (D230)", () => {
  it("les places : deux rangées dos à dos et une le long de l'avenue à l'est, six sous l'abri ; rien à l'ouest (gare routière)", () => {
    const stalls = findStalls(tile.ground["marks"]!).map((q) => st(q.x, q.y)).filter(inParvis);
    expect(stalls.length).toBeGreaterThanOrEqual(22);
    expect(stalls.length).toBeLessThanOrEqual(26);
    for (const [s] of stalls) expect(s).toBeGreaterThan(35);
    const under = stalls.filter(([s, t]) => s > 55 && t < -18 && t > -36 && s + t > 30);
    expect(under.length).toBeGreaterThanOrEqual(5);
  });

  it("plus aucune ancienne marque dans le parvis : les traits en tous sens de l'ouest sont partis", () => {
    const marks = tile.ground["marks"]!.map(centre).map(([x, y]) => st(x, y)).filter(inParvis);
    expect(marks.length).toBeLessThan(40);
    for (const [s] of marks) expect(s).toBeGreaterThan(35);
  });

  it("sols : allée de brique à panneaux clairs devant la porte, gravier le long du retour, quai de bus, zigzag jaune", () => {
    const has = (layer: string, s: number, t: number): boolean =>
      (tile.ground[layer] ?? []).some((p) => {
        // Anneau extérieur puis trous : un point dans un trou n'est pas dans le polygone.
        let inside = false;
        for (const r of p) {
          for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
            const [si, ti] = st(r[i]!, r[i + 1]!), [sj, tj] = st(r[j]!, r[j + 1]!);
            if ((ti > t) !== (tj > t) && s < si + ((t - ti) * (sj - si)) / (tj - ti)) inside = !inside;
          }
        }
        return inside;
      });
    expect(has("plaza_brick", 21.6, -20)).toBe(true);
    expect(has("plaza_concrete", 25.4, -5)).toBe(true);
    expect(has("plaza_asphalt", 25.4, -5)).toBe(false);
    expect(has("plaza_gravel", 61, -5)).toBe(true);
    expect((tile.ground["marks_yellow"] ?? []).length).toBeGreaterThanOrEqual(1);
    for (const p of tile.ground["marks_yellow"]!) {
      const [s, t] = st(...centre(p));
      expect(s).toBeGreaterThan(-21);
      expect(s).toBeLessThan(-4);
      expect(t).toBeLessThan(-13);
    }
    expect(sta.parvis).toBeDefined();
  });
});
