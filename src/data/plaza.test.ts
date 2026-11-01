import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HexagoneModel, TileData, TileKinds } from "./types";

/** D167 : le parvis de l'Hexagone (lot 3 de docs/plans/hexagone.md) : dallage en trois classes, sans clôture de parcelle. */
const tiles = ["27_35", "27_36"].map((id) => JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData);
const hex = (JSON.parse(readFileSync("public/data/kinds/27_35.json", "utf8")) as TileKinds).buildings["BATIMENT0000000348844694"]!.hex as HexagoneModel;

type Poly = number[][];
const ring = (r: readonly number[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (p: Poly, x: number, y: number): boolean => ring(p[0]!, x, y) && !p.slice(1).some((h) => ring(h, x, y));
const area = (r: readonly number[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
  }
  return Math.abs(a) / 2;
};
const polyArea = (p: Poly): number => area(p[0]!) - p.slice(1).reduce((s, h) => s + area(h), 0);
const layer = (name: string): Poly[] => tiles.flatMap((t) => t.ground[name] ?? []);
const covered = (name: string, x: number, y: number): boolean => layer(name).some((p) => inPoly(p, x, y));

describe("parvis de l'Hexagone (D167)", () => {
  it("trois classes de sol : fond clair, brique rose, ardoise, d'étendues plausibles (relevé : brique ≈ 250 m², ardoise ≈ 140 m²)", () => {
    const sum = (n: string): number => layer(n).reduce((s, p) => s + polyArea(p), 0);
    expect(sum("plaza_brick")).toBeGreaterThan(200);
    expect(sum("plaza_brick")).toBeLessThan(300);
    expect(sum("plaza_slate")).toBeGreaterThan(110);
    expect(sum("plaza_slate")).toBeLessThan(170);
    expect(sum("plaza_filet")).toBeGreaterThan(250);
    expect(sum("plaza_filet")).toBeLessThan(450);
  });

  it("la brique entoure la sphère (340,4 ; 175,2) ; les motifs ne se recouvrent jamais", () => {
    expect(covered("plaza_brick", 340.4, 175.2)).toBe(true);
    let both = 0, n = 0;
    for (let x = 316; x < 352; x += 0.5) {
      for (let y = 152; y < 190; y += 0.5) {
        const c = ["plaza_brick", "plaza_slate", "plaza_filet"].filter((k) => covered(k, x, y)).length;
        if (c > 1) both++;
        if (c) n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(both).toBe(0);
  });

  it("deux bandes de motifs d'ardoise le long de la diagonale ouest et au moins deux hexagones (aires de 15 à 40 m²)", () => {
    const hexes = layer("plaza_slate").filter((p) => p[0]!.length === 12 && polyArea(p) > 15 && polyArea(p) < 40);
    expect(hexes.length).toBeGreaterThanOrEqual(2);
    expect(layer("plaza_slate").length).toBeGreaterThanOrEqual(8);
  });

  it("aucun dallage ni sol de place sous le bâtiment, et plus de chaussée ni de trottoir sous le dallage", () => {
    for (const name of ["plaza_brick", "plaza_slate", "plaza_filet"]) {
      for (const p of layer(name)) {
        for (let i = 0; i < p[0]!.length; i += 2) expect(ring(hex.ring, p[0]![i]!, p[0]![i + 1]!)).toBe(false);
      }
    }
    for (const x of [332, 336, 340, 344]) {
      for (const y of [168, 172, 176, 180, 184]) {
        for (const other of ["road_asphalt", "walk", "lawn", "plaza_paving", "plaza_asphalt", "plaza_gravel", "plaza_sett"]) {
          if (covered("plaza_brick", x, y)) expect(covered(other, x, y), `${other} en (${x}, ${y})`).toBe(false);
        }
      }
    }
  });

  it("plus de clôture de parcelle (identifiants ≤ −900 000 000) commençant à moins de 50 m du parvis ; les murs réels restent", () => {
    for (const t of tiles) {
      for (const w of t.walls) {
        if (w.id > -900_000_000) continue;
        // `remove_fences` juge un tronçon sur son premier point : un long tronçon qui commence plus loin peut longer le parvis.
        expect(Math.hypot(w.pts[0]! - 335, w.pts[1]! - 172), `clôture ${w.id}`).toBeGreaterThan(50);
      }
    }
    expect(tiles[0]!.walls.some((w) => w.id === 249413461)).toBe(true);
  });
});
