import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStalls } from "../core/parking";
import type { HexagoneModel, TileData, TileKinds } from "./types";

/** D169 : le parking de l'Hexagone (lot 5 de docs/plans/hexagone.md) : six rangées lues à l'orthophotographie, 110 places tracées. */
const tile = JSON.parse(readFileSync("public/data/tiles/27_36.json", "utf8")) as TileData;
const hex = (JSON.parse(readFileSync("public/data/kinds/27_35.json", "utf8")) as TileKinds).buildings["BATIMENT0000000348844694"]!.hex as HexagoneModel;
const A = (37 * Math.PI) / 180;
/** Repère redressé de `parkings` (manual.json) : u le long des rangées, v le long des traits. */
const uv = (x: number, y: number): [number, number] => [(x - 325) * Math.cos(A) + (y - 245) * Math.sin(A), (x - 325) * Math.sin(A) - (y - 245) * Math.cos(A)];
const inZone = (x: number, y: number): boolean => {
  const [u, v] = uv(x, y);
  return u > -31 && u < 47 && v > -43 && v < 35;
};
const cap = (dx: number, dy: number): number => (((Math.atan2(dx, dy) * 180) / Math.PI) % 180 + 180) % 180;

describe("parking de l'Hexagone (D169)", () => {
  const stalls = findStalls(tile.ground["marks"]!).filter((s) => inZone(s.x, s.y));

  it("110 places retrouvées par `findStalls` (± 10 %), sans doublon", () => {
    expect(stalls.length).toBeGreaterThanOrEqual(99);
    expect(stalls.length).toBeLessThanOrEqual(121);
    for (let i = 0; i < stalls.length; i++) {
      for (let j = i + 1; j < stalls.length; j++) expect(Math.hypot(stalls[i]!.x - stalls[j]!.x, stalls[i]!.y - stalls[j]!.y)).toBeGreaterThan(1.2);
    }
  });

  it("toutes les places sont dans le sens des traits (143° ± 3°), et chaque rangée a un pas de 2,4 à 2,6 m", () => {
    for (const s of stalls) {
      const h = ((((s.heading * 180) / Math.PI) % 180) + 180) % 180;
      expect(Math.abs(h - 143), `place (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`).toBeLessThan(3);
    }
    // Pas : les places d'une même demi-rangée (même v à 0,5 m) se suivent à 2,4-2,6 m le long de u.
    const rows = new Map<number, number[]>();
    for (const s of stalls) {
      const [u, v] = uv(s.x, s.y);
      const key = Math.round(v / 0.5);
      rows.set(key, [...(rows.get(key) ?? []), u]);
    }
    let checked = 0;
    for (const us of rows.values()) {
      us.sort((a, b) => a - b);
      for (let i = 1; i < us.length; i++) {
        const d = us[i]! - us[i - 1]!;
        if (d < 4) {
          expect(d).toBeGreaterThan(2.4);
          expect(d).toBeLessThan(2.6);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it("plus aucune ancienne marque dans la zone : les traits sont tous à 143° (traits) ou 53° (lignes de fond), de 10 cm de large", () => {
    let n = 0;
    for (const p of tile.ground["marks"]!) {
      const r = p[0]!;
      let cx = 0, cy = 0;
      for (let i = 0; i < r.length; i += 2) { cx += r[i]!; cy += r[i + 1]!; }
      cx /= r.length / 2;
      cy /= r.length / 2;
      if (!inZone(cx, cy)) continue;
      n++;
      let best = 0, ang = 0;
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length, dx = r[j]! - r[i]!, dy = r[j + 1]! - r[i + 1]!, l = Math.hypot(dx, dy);
        if (l > best) { best = l; ang = cap(dx, dy); }
      }
      if (best < 0.4) continue; // éclat de coupe
      const ok = Math.abs(ang - 143) < 3 || Math.abs(ang - 53) < 3;
      expect(ok, `marque en (${cx.toFixed(1)}, ${cy.toFixed(1)}) à ${ang.toFixed(0)}°`).toBe(true);
    }
    expect(n).toBeGreaterThan(100);
  });

  it("aucun trait dans le bâtiment de l'Hexagone ni dans un autre bâtiment", () => {
    const rings = [hex.ring, ...tile.buildings.map((b) => b.ring)];
    const inRing = (r: readonly number[], x: number, y: number): boolean => {
      let inside = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        if (r[i + 1]! > y !== r[j + 1]! > y && x < ((r[j]! - r[i]!) * (y - r[i + 1]!)) / (r[j + 1]! - r[i + 1]!) + r[i]!) inside = !inside;
      }
      return inside;
    };
    for (const p of tile.ground["marks"]!) {
      const r = p[0]!;
      if (!inZone(r[0]!, r[1]!)) continue;
      for (const ring of rings) expect(inRing(ring, r[0]!, r[1]!)).toBe(false);
    }
  });
});
