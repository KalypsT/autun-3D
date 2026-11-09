import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TileData, Wall } from "./types";

/** D304 : clôtures de parcelle confrontées au relevé LiDAR, un matériau par côté de rue (tools/data/prune_fences.py). */
const FENCE_ID = 900_000_000;
const isParcelFence = (w: Wall): boolean => w.id <= -FENCE_ID && w.id > -FENCE_ID - 1_000_000 && ["wall", "fence", "hedge"].includes(w.kind);

/** Clôtures citées par un ouvrage qui les remplace : gardées telles quelles par prune_fences.py. */
function protectedIds(): Set<number> {
  const ids = new Set<number>((JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { dropWalls?: number[] }).dropWalls ?? []);
  const walk = (o: unknown, key?: string): void => {
    if (Array.isArray(o)) {
      if (key === "walls" && o.every((v) => Number.isInteger(v))) for (const v of o as number[]) ids.add(v);
      else for (const v of o) walk(v);
    } else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
  };
  for (const f of readdirSync("public/data/kinds")) if (f.endsWith(".json")) walk(JSON.parse(readFileSync(`public/data/kinds/${f}`, "utf8")));
  return ids;
}

const keep = protectedIds();
const fences = readdirSync("public/data/tiles")
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(`public/data/tiles/${f}`, "utf8")) as TileData).walls)
  .filter((w) => isParcelFence(w) && !keep.has(w.id));

const length = (w: Wall): number => {
  let s = 0;
  for (let i = 0; i + 3 < w.pts.length; i += 2) s += Math.hypot(w.pts[i + 2]! - w.pts[i]!, w.pts[i + 3]! - w.pts[i + 1]!);
  return s;
};
const ends = (w: Wall): [number, number][] => [[w.pts[0]!, w.pts[1]!], [w.pts[w.pts.length - 2]!, w.pts[w.pts.length - 1]!]];
const dir = (w: Wall): [number, number] => {
  const ax = w.pts[0]!, ay = w.pts[1]!, bx = w.pts[w.pts.length - 2]!, by = w.pts[w.pts.length - 1]!;
  const L = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / L, (by - ay) / L];
};

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

describe("clôtures de parcelle (D304)", () => {
  it("il en reste moins d'un tiers (98 km posés par D94 et D96)", () => {
    const km = fences.reduce((s, w) => s + length(w), 0) / 1000;
    expect(km).toBeGreaterThan(15);
    expect(km).toBeLessThan(35);
  });

  it("chacune a une hauteur mesurée au LiDAR", () => {
    for (const w of fences) {
      expect(w.measured, String(w.id)).toBeGreaterThanOrEqual(0.6);
      expect(w.height, String(w.id)).toBeGreaterThanOrEqual(0.6);
      expect(w.height, String(w.id)).toBeLessThanOrEqual(2.5);
    }
  });

  it("un seul matériau d'un tronçon au suivant le long d'une rue", () => {
    const grid = new Map<string, Wall[]>();
    const key = (x: number, y: number): string => `${Math.floor(x / 2.5)},${Math.floor(y / 2.5)}`;
    for (const w of fences) for (const [x, y] of ends(w)) grid.set(key(x, y), [...(grid.get(key(x, y)) ?? []), w]);
    let pairs = 0;
    for (const w of fences) {
      for (const [x, y] of ends(w)) {
        for (const o of grid.get(key(x, y)) ?? []) {
          if (o === w || Math.min(...ends(o).map(([u, v]) => Math.hypot(u - x, v - y))) > 1.5) continue;
          const [a, b] = dir(w), [c, d] = dir(o);
          if (Math.abs(a * c + b * d) < Math.cos(Math.PI / 6)) continue;
          pairs++;
          expect(o.kind, `${w.id} / ${o.id}`).toBe(w.kind);
        }
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it("plus de murets inventés dans la rue de la capture (tuile 27_38)", () => {
    const near = fences.filter((w) => {
      for (let i = 0; i + 1 < w.pts.length; i += 2) if (distToSegment(w.pts[i]!, w.pts[i + 1]!, 317, 800, 321, 852) < 6) return true;
      return false;
    });
    expect(near).toEqual([]);
  });
});
