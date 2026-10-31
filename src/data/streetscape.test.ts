import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStalls } from "../core/parking";
import type { TileData } from "./types";

/** D153 : la chaussée de la place du Champ de Mars (tools/data/build_streetscape.py). */
const TILES = ["25_34", "26_34", "25_35", "26_35"];
const PLACE = [671039846, 1333715967, 671039850, 1343418270];

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

const tiles = TILES.map((id) => JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData);
const streets = JSON.parse(readFileSync("public/data/streets.json", "utf8")) as { id: number; width: number; pts: number[]; oneway: number }[];
const place = streets.filter((s) => PLACE.includes(s.id));
const onRoad = (x: number, y: number): boolean => tiles.some((t) => (t.ground["road_asphalt"] ?? []).some((p) => inPolygon(x, y, p)));
const onPlaza = (x: number, y: number): boolean => tiles.some((t) => Object.keys(t.ground).some((k) => k.startsWith("plaza_") && t.ground[k]!.some((p) => inPolygon(x, y, p))));

/** Points tous les 2 m sur l'axe d'une voie, avec le vecteur normal. */
function along(pts: number[]): { x: number; y: number; nx: number; ny: number }[] {
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2]! - pts[i]!, dy = pts[i + 3]! - pts[i + 1]!, L = Math.hypot(dx, dy);
    for (let d = 1; d < L; d += 2) out.push({ x: pts[i]! + (dx * d) / L, y: pts[i + 1]! + (dy * d) / L, nx: -dy / L, ny: dx / L });
  }
  return out;
}

describe("la place du Champ de Mars a une chaussée (D153)", () => {
  it("les quatre tronçons de la place sont dans les données", () => {
    expect(place).toHaveLength(4);
  });

  it("chaussée continue sur l'axe, et sur 90 % de la largeur de la voie à ± 40 cm près", () => {
    for (const s of place) {
      for (const p of along(s.pts)) {
        expect(onRoad(p.x, p.y)).toBe(true);
        const h = s.width / 2 - 0.4;
        // Un bâtiment peut rogner un bord : on exige les deux bords sauf à moins de 0,5 m d'un mur (les voies de la place n'en ont pas).
        expect(onRoad(p.x + p.nx * h, p.y + p.ny * h)).toBe(true);
        expect(onRoad(p.x - p.nx * h, p.y - p.ny * h)).toBe(true);
      }
    }
  });

  it("aucune place de parking n'est dessinée sous la chaussée", () => {
    for (const s of place) for (const p of along(s.pts)) expect(onPlaza(p.x, p.y)).toBe(false);
  });

  it("aucun trait de stationnement ne touche la chaussée de la place", () => {
    for (const t of tiles) {
      for (const stall of findStalls(t.ground["marks"] ?? [])) {
        for (const s of place) {
          for (const p of along(s.pts)) expect(Math.hypot(stall.x - p.x, stall.y - p.y) > 1.2).toBe(true);
        }
      }
    }
  });

  it("l'axe discontinu et les passages piétons sont dans la chaussée", () => {
    const marks = tiles.flatMap((t) => t.ground["marks"] ?? []);
    let onAxis = 0;
    for (const m of marks) {
      const x = m[0]!.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (m[0]!.length / 2);
      const y = m[0]!.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (m[0]!.length / 2);
      if (place.some((s) => along(s.pts).some((p) => Math.hypot(p.x - x, p.y - y) < 1.2))) onAxis++;
    }
    expect(onAxis).toBeGreaterThan(5);
  });

  it("il reste des centaines de places dans le centre-ville", () => {
    let total = 0;
    for (const t of tiles) total += findStalls(t.ground["marks"] ?? []).length;
    expect(total).toBeGreaterThan(100);
  });
});

/** D154 : les rangées du grand parking (orthophotographie redressée de 32,7°). */
describe("les places du grand parking du Champ de Mars (D154)", () => {
  const manual = JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { streetscape: { lots: { frame: { o: number[]; angle: number }; zone: number[]; strips: { u: number[]; v: number[] }[] }[] } };
  const lot = manual.streetscape.lots[0]!;
  const a = (lot.frame.angle * Math.PI) / 180;
  const uv = (x: number, y: number): [number, number] => {
    const dx = x - lot.frame.o[0]!, dy = y - lot.frame.o[1]!;
    return [dx * Math.cos(a) + dy * Math.sin(a), dx * Math.sin(a) - dy * Math.cos(a)];
  };
  const stalls = tiles.flatMap((t) => findStalls(t.ground["marks"] ?? [])).filter((s) => {
    const [u, v] = uv(s.x, s.y);
    return u > lot.zone[0]! && u < lot.zone[2]! && v > lot.zone[1]! && v < lot.zone[3]!;
  });

  it("entre 75 et 105 places dans les rangées lues (94 tracées)", () => {
    expect(stalls.length).toBeGreaterThan(75); // 94 tracées : celles que la limite des tuiles (x = −20, y = −62) coupe ne sont plus retrouvées
    expect(stalls.length).toBeLessThan(105);
  });

  it("toutes les places sont perpendiculaires à la rangée (à 5° près)", () => {
    for (const s of stalls) {
      const along = Math.atan2(Math.cos(a), Math.sin(a)); // cap de l'axe u (0 = nord)
      const perp = along + Math.PI / 2;
      const d = Math.abs(((s.heading - perp + Math.PI * 3) % Math.PI) - Math.PI / 2) ;
      expect(Math.min(d, Math.PI - d)).toBeGreaterThan(Math.PI / 2 - 0.09);
    }
  });

  it("aucune place dans l'allée piétonne centrale", () => {
    const strip = lot.strips[0]!;
    for (const s of stalls) {
      const [u] = uv(s.x, s.y);
      expect(u < strip.u[0]! - 0.5 || u > strip.u[1]! + 0.5).toBe(true);
    }
  });

  it("l'allée piétonne est en dallage clair, hors des places de stationnement noires", () => {
    const strip = lot.strips[0]!;
    const mid = [(strip.u[0]! + strip.u[1]!) / 2, 0];
    const a2 = a;
    const x = lot.frame.o[0]! + mid[0]! * Math.cos(a2) + mid[1]! * Math.sin(a2);
    const y = lot.frame.o[1]! + mid[0]! * Math.sin(a2) - mid[1]! * Math.cos(a2);
    expect(tiles.some((t) => (t.ground["plaza_paving"] ?? []).some((p) => inPolygon(x, y, p)))).toBe(true);
    expect(tiles.some((t) => (t.ground["plaza_asphalt"] ?? []).some((p) => inPolygon(x, y, p)))).toBe(false);
  });
});
