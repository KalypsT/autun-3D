import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TileData } from "./types";

/** Point dans un polygone (anneau extérieur puis trous, coordonnées aplaties), règle pair-impair. */
function inPolygon(x: number, y: number, poly: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (const ring of poly) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[2 * i]!, yi = ring[2 * i + 1]!, xj = ring[2 * j]!, yj = ring[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const ROADS = ["road_asphalt", "road_sett", "road_gravel", "road_paving"];

describe("bords de chaussée (tools/data/roadside.py)", () => {
  const tiles = readdirSync("public/data/tiles").map((n) => JSON.parse(readFileSync(`public/data/tiles/${n}`, "utf8")) as TileData);
  const onRoad = (t: TileData, x: number, y: number): boolean => ROADS.some((k) => (t.ground[k] ?? []).some((p) => inPolygon(x, y, p)));

  it("aucun feu tricolore dans la chaussée", () => {
    const bad = tiles.flatMap((t) => t.furniture.filter((f) => f.kind === "traffic_signals" && onRoad(t, f.x, f.y)));
    expect(bad).toEqual([]);
  });

  it("aucun tronc d'arbre dans la chaussée", () => {
    const bad = tiles.flatMap((t) => t.trees.filter(([x, y]) => onRoad(t, x, y)));
    expect(bad).toEqual([]);
  });
});
