import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { at, eduenFrame, eduenLines, eduenMasts } from "../core/landmarks";
import { findStalls } from "../core/parking";
import { loadRealWorld } from "../core/testing";
import { buildColliders } from "../core/world";
import type { EduenModel, TileData, TileKinds } from "./types";

/** D233 : le parking de l'Eduen (rangées lues sur l'orthophotographie) et les abords (mâts, haie, clôture, barrière). */
const ID = "BATIMENT0000000348847362";
const m = (JSON.parse(readFileSync("public/data/kinds/32_37.json", "utf8")) as TileKinds).buildings[ID]!.edu as EduenModel;
const st = (x: number, y: number): [number, number] => {
  const dx = x - m.o[0], dy = y - m.o[1], c = Math.cos(m.a), s = Math.sin(m.a);
  return [dx * c + dy * s, -dx * s + dy * c];
};
const inLot = ([s, t]: [number, number]): boolean => s > -55 && s < 52 && t > 40 && t < 104;

describe("parking de l'Eduen (D233)", () => {
  it("les places : environ 140 (hors places PMR, plus larges), dans les rangées, aucune dans les allées", () => {
    const stalls = ["32_37", "33_37", "32_38"]
      .flatMap((id) => findStalls((JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData).ground["marks"] ?? []))
      .map((q) => st(q.x, q.y)).filter(inLot);
    expect(stalls.length).toBeGreaterThan(110);
    expect(stalls.length).toBeLessThan(170);
    // Les places tombent dans les cinq bandes de rangées (A, B des deux côtés, C des deux côtés) ou la rangée ouest, pas dans les allées.
    const bands = [[96, 102], [79.5, 90.5], [62.7, 73.7], [44.5, 50.5]];
    for (const [, t] of stalls) expect(bands.some(([a, b]) => t > a! && t < b!)).toBe(true);
  });

  it("les abords : mâts sur la bande verte, clôture, haie et barrière arrêtent les déplacements", () => {
    const world = loadRealWorld();
    const b = world.tile.buildings.find((q) => q.id === ID)!;
    const c = buildColliders({ ...world.tile, buildings: [b] });
    const f = eduenFrame(m);
    for (const [s, t] of eduenMasts(m)) {
      expect(s).toBeGreaterThan(60);
      expect(t).toBeGreaterThan(60);
    }
    expect(eduenLines(m).map((l) => l.kind)).toEqual(["fence", "hedge", "barrier"]);
    // Un piéton posé sur la clôture (route de Chalon), sur la haie de l'îlot ou sous le bras de la barrière en est repoussé ; la clôture
    // et la barrière laissent passer la vue (les rayons), pas la haie.
    const push = (s: number, t: number): boolean => c.resolve(...at(f, s, t), 0.3).hit;
    const fence = m.site!.fence[0]!;
    expect(push(20, fence[1])).toBe(true);
    expect(push(m.site!.hedge[6]![0], 65)).toBe(true);
    const [p, q] = m.site!.barrier;
    expect(push((p[0] + q[0]) / 2, p[1])).toBe(true);
    expect(push(20, fence[1] - 3)).toBe(false);
    const h0 = at(f, 48, 66), h1 = at(f, 57, 66);
    expect(c.raycast(h0[0], h0[1], h1[0], h1[1])).not.toBeNull();
  });
});
