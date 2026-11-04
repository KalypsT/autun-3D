import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { at, bowlingFrame, roadsideLines } from "../core/landmarks";
import { findStalls } from "../core/parking";
import { loadRealWorld } from "../core/testing";
import { buildColliders } from "../core/world";
import type { BowlingModel, McdoModel, TileData, TileKinds } from "./types";

/** D236 : parkings du McDonald's et du bowling de la route de Chalon (rangées lues sur l'orthophotographie, dalle sans marquage) et abords. */
const MCDO = "BATIMENT0000000348847408", BOWL = "BATIMENT0000000348847403";
const kinds = (id: string): TileKinds => JSON.parse(readFileSync(`public/data/kinds/${id}.json`, "utf8")) as TileKinds;
const mc = kinds("31_38").buildings[MCDO]!.mcd as McdoModel;
const bw = kinds("31_37").buildings[BOWL]!.bowl as BowlingModel;
const tiles = ["31_37", "31_38"].map((id) => JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData);
/** (s, t) d'un point du monde dans un repère d'origine o et d'angle a. */
const st = (o: readonly number[], a: number, x: number, y: number): [number, number] => {
  const dx = x - o[0]!, dy = y - o[1]!, c = Math.cos(a), s = Math.sin(a);
  return [dx * c + dy * s, -dx * s + dy * c];
};

describe("parkings du McDonald's et du bowling (D236)", () => {
  it("McDonald's : la rangée nord retrouvée par le jeu (cinq places de 2,5 m), les places PMR peintes en bleu", () => {
    const stalls = tiles.flatMap((t) => findStalls(t.ground["marks"] ?? [])).map((q) => st(mc.o, mc.a, q.x, q.y));
    const north = stalls.filter(([s, t]) => s > -23 && s < -9 && t > 28 && t < 35);
    expect(north.length).toBe(5);
    // Fond bleu des places PMR devant le long côté du parking (ouest), entre 11,7 et 18,9 m.
    const blue = tiles.flatMap((t) => t.ground["marks_blue"] ?? []);
    expect(blue.length).toBeGreaterThan(0);
    for (const poly of blue) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 2) {
          const [s, t] = st(mc.o, mc.a, ring[i]!, ring[i + 1]!);
          expect(s).toBeGreaterThan(-9);
          expect(s).toBeLessThan(-3);
          expect(t).toBeGreaterThan(11);
          expect(t).toBeLessThan(19.5);
        }
      }
    }
  });

  it("bowling : dalle de béton sans aucun trait, terrasse au gazon synthétique devant le pignon", () => {
    const inSlab = ([s, t]: [number, number]): boolean => s > -31 && s < 25 && t > 28.5 && t < 43;
    for (const tile of tiles) {
      for (const poly of tile.ground["marks"] ?? []) {
        const ring = poly[0]!;
        let x = 0, y = 0;
        for (let i = 0; i < ring.length; i += 2) { x += ring[i]!; y += ring[i + 1]!; }
        expect(inSlab(st(bw.o, bw.a, (2 * x) / ring.length, (2 * y) / ring.length))).toBe(false);
      }
    }
    const f = bowlingFrame(bw), [cx, cy] = at(f, 0, 35), [px, py] = at(f, 8, -2);
    const has = (layer: string, x: number, y: number): boolean => tiles.some((t) => (t.ground[layer] ?? []).some((poly) => inside(poly[0]!, x, y)));
    expect(has("plaza_concrete", cx, cy)).toBe(true);
    expect(has("pitch", px, py)).toBe(true);
  });

  it("abords : la haie de la D680 arrête, le garde-corps de la terrasse aussi mais laisse passer la vue", () => {
    const world = loadRealWorld();
    const b = world.tile.buildings.filter((q) => q.id === BOWL || q.id === MCDO);
    const c = buildColliders({ ...world.tile, buildings: b });
    const f = bowlingFrame(bw);
    expect(roadsideLines({ bowl: bw }).map((l) => l.kind)).toEqual(["fence", "fence", "hedge"]);
    expect(roadsideLines({ mcd: mc }).every((l) => l.kind === "fence")).toBe(true);
    const push = (s: number, t: number): boolean => c.resolve(...at(f, s, t), 0.3).hit;
    expect(push(-10, -9)).toBe(true);
    expect(push(4, -4.4)).toBe(true);
    expect(push(-10, -12)).toBe(false);
    const r0 = at(f, 4, -6), r1 = at(f, 4, -3);
    expect(c.raycast(r0[0], r0[1], r1[0], r1[1])).toBeNull();
  });
});

function inside(ring: number[], x: number, y: number): boolean {
  let ok = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
