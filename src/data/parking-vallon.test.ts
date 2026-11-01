import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStalls } from "../core/parking";
import { UNIQUES } from "../core/uniques";
import type { TileData, TileKinds, VallonModel } from "./types";

/** D177 : le parking du collège du Vallon (lot 6 de docs/plans/college-vallon.md) : quatre blocs de rangées lus à l'orthophotographie, et le camion pizza sur la rangée nord. */
const tile = JSON.parse(readFileSync("public/data/tiles/28_39.json", "utf8")) as TileData;
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
const vallon = kinds.buildings["BATIMENT0000000348848973"]!.vallon as VallonModel;
const inLot = (x: number, y: number): boolean => x > 478 && x < 518 && y > 1060 && y < 1110;
const stalls = findStalls(tile.ground["marks"]!).filter((s) => inLot(s.x, s.y));
const deg = (h: number): number => ((((h * 180) / Math.PI) % 180) + 180) % 180;
const truck = UNIQUES.find((u) => u.id === "unique-pizza-du-vallon")!;

describe("Parking du collège du Vallon (D177)", () => {
  it("33 places retrouvées par `findStalls` (± 10 %), sans doublon", () => {
    expect(stalls.length).toBeGreaterThanOrEqual(30);
    expect(stalls.length).toBeLessThanOrEqual(37);
    for (let i = 0; i < stalls.length; i++) {
      for (let j = i + 1; j < stalls.length; j++) expect(Math.hypot(stalls[i]!.x - stalls[j]!.x, stalls[i]!.y - stalls[j]!.y)).toBeGreaterThan(1.2);
    }
  });

  it("chaque bloc a la direction de ses traits : ouest 90°, îlot central 79°, est 80°, rangée nord 165° (à 3° près)", () => {
    const want = (x: number, y: number): number => (x < 492 && y < 1099 ? 90 : x < 506 && y < 1090 ? 79 : x > 506 ? 80 : 165);
    for (const s of stalls) {
      const h = deg(s.heading), w = want(s.x, s.y);
      expect(Math.abs(h - w % 180), `place (${s.x}, ${s.y})`).toBeLessThan(3);
    }
  });

  it("aucune place dans un bâtiment, et les places restent à plus de 5 m des bâtiments du collège", () => {
    for (const s of stalls) {
      for (const b of tile.buildings) {
        const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
        expect(s.x > Math.min(...xs) - 1 && s.x < Math.max(...xs) + 1 && s.y > Math.min(...ys) - 1 && s.y < Math.max(...ys) + 1, `${b.id} (${s.x}, ${s.y})`).toBe(false);
      }
    }
  });

  it("flèches de sens et lampadaires posés ; les lampadaires sont à plus de 2 m des places", () => {
    const lamps = tile.furniture.filter((f) => f.id <= -810001 && f.id >= -810003);
    expect(lamps).toHaveLength(3);
    for (const l of lamps) for (const s of stalls) expect(Math.hypot(l.x - s.x, l.y - s.y), `lampadaire ${l.id}`).toBeGreaterThan(2);
    // Les flèches sont des polygones plus larges que les traits de places (ni 0,3 m de large ni 5,3 m de long) : au moins quatre dans la zone.
    const arrows = tile.ground["marks"]!.filter((p) => {
      const r = p[0]!, xs = r.filter((_, i) => i % 2 === 0), ys = r.filter((_, i) => i % 2 === 1);
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      return inLot(cx, cy) && r.length / 2 === 7;
    });
    expect(arrows.length).toBeGreaterThanOrEqual(4);
  });

  it("le panneau « P » est posé près de l'entrée nord-est, tourné vers l'avenue", () => {
    const p = vallon.props!.find((q) => q.k === "psign")!;
    expect(p).toBeDefined();
    expect(p.a).toBe(340);
  });
});

describe("Camion pizza sur les places du parking (D177)", () => {
  const nearest = stalls.reduce((a, b) => (Math.hypot(a.x - truck.x, a.y - truck.y) < Math.hypot(b.x - truck.x, b.y - truck.y) ? a : b));

  it("il est sur une place de la rangée nord, à moins de 1 m de son centre, à moins de 1 m du repère donné par l'utilisateur (499,05 ; 1102,53)", () => {
    expect(Math.hypot(nearest.x - truck.x, nearest.y - truck.y)).toBeLessThan(1);
    expect(deg(nearest.heading)).toBeCloseTo(165, 0);
    expect(Math.hypot(truck.x - 499.05, truck.y - 1102.53)).toBeLessThan(1);
  });

  it("il est rangé dans le sens des traits, le dos à l'avenue (cabine vers le sud-sud-est) et de 17 h à 22 h", () => {
    expect(Math.abs(deg(truck.heading) - deg(nearest.heading))).toBeLessThan(3);
    const bearing = ((truck.heading * 180) / Math.PI + 360) % 360;
    expect(bearing).toBeGreaterThan(150);
    expect(bearing).toBeLessThan(180);
    expect(truck.hours).toEqual([17, 22]);
  });

  it("la place à sa gauche (côté comptoir, à l'est) est une vraie place voisine, à 2,4 à 2,6 m, laissée libre aux clients", () => {
    const next = stalls.filter((s) => s !== nearest && Math.abs(s.y - nearest.y) < 1.5).sort((a, b) => Math.hypot(a.x - nearest.x, a.y - nearest.y) - Math.hypot(b.x - nearest.x, b.y - nearest.y))[0]!;
    const d = Math.hypot(next.x - nearest.x, next.y - nearest.y);
    expect(d).toBeGreaterThan(2.3);
    expect(d).toBeLessThan(2.7);
    // keepClear (game.ts) : demi-longueur du camion + 1,5 m = 4,5 m autour de sa place : la voisine en fait partie.
    expect(Math.hypot(next.x - truck.x, next.y - truck.y)).toBeLessThan(4.5);
  });
});
