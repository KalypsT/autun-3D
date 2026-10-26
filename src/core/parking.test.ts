import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TileData } from "../data/types";
import { findStalls } from "./parking";

/** Trait de marquage de 4,8 × 0,1 m centré en (x, y), dans l'axe nord-sud. */
function bar(x: number, y: number): number[][] {
  return [[x - 0.05, y - 2.4, x + 0.05, y - 2.4, x + 0.05, y + 2.4, x - 0.05, y + 2.4]];
}

describe("findStalls", () => {
  it("une place entre deux traits voisins, aucune au bout de la rangée", () => {
    const stalls = findStalls([bar(0, 0), bar(2.5, 0), bar(5, 0), [[0, 10, 1, 10, 1, 11]]]);
    expect(stalls).toHaveLength(2);
    const xs = stalls.map((s) => s.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(1.25, 5);
    expect(xs[1]).toBeCloseTo(3.75, 5);
    expect(Math.abs(Math.cos(stalls[0]!.heading))).toBeCloseTo(1, 5);
  });

  it("ignore les traits trop éloignés et les passages piétons", () => {
    expect(findStalls([bar(0, 0), bar(6, 0)])).toHaveLength(0);
    const zebra = [[[0, 0, 3, 0, 3, 0.5, 0, 0.5]], [[0, 0.9, 3, 0.9, 3, 1.4, 0, 1.4]]];
    expect(findStalls(zebra)).toHaveLength(0);
  });

  it("trouve des centaines de places sur les vraies tuiles (Champ de Mars compris)", () => {
    let total = 0, nearSpawn = 0;
    for (const name of readdirSync("public/data/tiles")) {
      const t = JSON.parse(readFileSync(`public/data/tiles/${name}`, "utf8")) as TileData;
      const stalls = findStalls(t.ground?.["marks"] ?? []);
      total += stalls.length;
      nearSpawn += stalls.filter((s) => Math.hypot(s.x + 10, s.y + 40) < 60).length;
    }
    expect(total).toBeGreaterThan(200);
    expect(nearSpawn).toBeGreaterThan(10);
  });
});
