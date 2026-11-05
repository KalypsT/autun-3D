import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../render/geometry";
import { buildReeds, reedTufts } from "../render/reeds";
import type { HeightField, TileData, TileStructures } from "./types";

/** D244 : le chemin du tour du plan d'eau du Vallon (lot 1 de docs/plans/vallon-lac.md), posé par tools/data/build_vallon_path.py. */
type Path = { name: string; w: number; p: number[] };
const paths = (JSON.parse(readFileSync("tools/data/vallon_path.json", "utf8")) as { paths: Path[] }).paths;
const spec = (JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { vallonPath: {
  noReeds: { circles: [number, number, number][]; boxes: [number, number, number, number][] };
} }).vallonPath;
const IDS = ["30_35", "31_35", "32_35", "30_36", "31_36", "32_36", "30_37", "31_37", "32_37", "31_34"];
const tiles = IDS.map((id) => [id, JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData] as const);
const structures = IDS.filter((id) => existsSync(`public/data/structures/${id}.json`))
  .map((id) => JSON.parse(readFileSync(`public/data/structures/${id}.json`, "utf8")) as TileStructures);

type P = [number, number];
const pts = (flat: readonly number[]): P[] => flat.flatMap((v, i) => (i % 2 === 0 ? [[v, flat[i + 1]!] as P] : []));
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const lineDist = (p: P, line: readonly P[]): number => Math.min(...line.slice(1).map((b, i) => segDist(p, line[i]!, b)));
function inRing(p: P, ring: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const waterRings = structures.flatMap((s) => s.water.map((poly) => poly.map(pts)));
const inWater = (p: P): boolean => waterRings.some((poly) => inRing(p, poly[0]!) && !poly.slice(1).some((h) => inRing(p, h)));
const edgeDist = (p: P): number => Math.min(...waterRings.flatMap((poly) => poly.map((r) => lineDist(p, [...r, r[0]!]))));
const lines = paths.map((p) => ({ ...p, line: pts(p.p) }));
const loop = lines.filter((p) => p.name.startsWith("Allée Marcel Lucotte"));
const len = (l: readonly P[]): number => l.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - l[i]![0], b[1] - l[i]![1]), 0);

describe("Chemin du tour du plan d'eau du Vallon (D244)", () => {
  it("la boucle : trois tronçons, 1,8 à 2 km, refermée (le raccord par la base nautique fait moins de 45 m)", () => {
    expect(loop.map((p) => p.name)).toEqual(["Allée Marcel Lucotte, sud et ouest", "Allée Marcel Lucotte, digue", "Allée Marcel Lucotte, est"]);
    const total = loop.reduce((s, p) => s + len(p.line), 0);
    expect(total).toBeGreaterThan(1800);
    expect(total).toBeLessThan(2000);
    const [a, b, c] = loop.map((p) => p.line);
    const gap = (u: P, v: P): number => Math.hypot(u[0] - v[0], u[1] - v[1]);
    expect(gap(a!.at(-1)!, b![0]!)).toBeLessThan(1);
    expect(gap(b!.at(-1)!, c![0]!)).toBeLessThan(45);
    expect(gap(c!.at(-1)!, a![0]!)).toBeLessThan(1);
  });

  it("largeurs mesurées : 3,2 m, 2 m sur la digue", () => {
    expect(loop.map((p) => p.w)).toEqual([3.2, 2.0, 3.2]);
  });

  it("l'axe ne passe jamais dans l'eau ni à moins de 2 m du bord (tous les 2 m)", () => {
    for (const p of loop) {
      for (let i = 0; i + 1 < p.line.length; i++) {
        const [a, b] = [p.line[i]!, p.line[i + 1]!];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let k = 0; k <= n; k++) {
          const q: P = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          expect(inWater(q), `${p.name} (${q[0].toFixed(1)}, ${q[1].toFixed(1)})`).toBe(false);
          expect(edgeDist(q), `${p.name} (${q[0].toFixed(1)}, ${q[1].toFixed(1)})`).toBeGreaterThan(2);
        }
      }
    }
  });

  it("le sol `path_gravel` est posé (6 000 à 7 500 m²), hors de l'eau", () => {
    let area = 0, n = 0;
    for (const [, t] of tiles) {
      for (const poly of t.ground["path_gravel"] ?? []) {
        n++;
        const r = pts(poly[0]!);
        let a = 0;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]);
        area += Math.abs(a) / 2;
        for (const q of r) expect(inWater(q), `sommet (${q[0]}, ${q[1]})`).toBe(false);
      }
    }
    expect(n).toBeGreaterThan(5);
    expect(area).toBeGreaterThan(6000);
    expect(area).toBeLessThan(7500);
  });

  it("aucun arbre sur le chemin (à plus de largeur / 2 + 0,5 m de l'axe)", () => {
    for (const [id, t] of tiles) {
      for (const tr of t.trees) {
        for (const p of lines) expect(lineDist([tr[0], tr[1]], p.line), `${id} arbre (${tr[0]}, ${tr[1]}) / ${p.name}`).toBeGreaterThan(p.w / 2 + 0.5);
      }
    }
  });

  it("16 lampadaires sur la rive est, côté terre, hors du chemin, crosse vers lui", () => {
    const lamps = tiles.flatMap(([, t]) => t.furniture.filter((f) => f.id <= -871_000_000 && f.id > -872_000_000));
    expect(lamps.length).toBe(16);
    const est = loop[2]!;
    for (const f of lamps) {
      const d = lineDist([f.x, f.y], est.line);
      expect(d).toBeGreaterThan(est.w / 2 + 0.3);
      expect(d).toBeLessThan(est.w / 2 + 1.5);
      expect(inWater([f.x, f.y])).toBe(false);
      // La crosse pointe vers le chemin : 1 m dans sa direction rapproche de l'axe.
      const ahead: P = [f.x + Math.cos(f.rot!), f.y + Math.sin(f.rot!)];
      expect(lineDist(ahead, est.line)).toBeLessThan(d);
    }
  });

  it("roseaux : au bord de l'eau, jamais près des pontons, de la cale, de la base ni des pelouses de pêche", () => {
    const reeds = structures.flatMap((s) => s.reeds ?? []);
    const total = reeds.reduce((s, r) => s + len(pts(r.p)), 0);
    expect(total).toBeGreaterThan(400);
    expect(total).toBeLessThan(1200);
    for (const r of reeds) {
      for (const q of pts(r.p)) {
        expect(edgeDist(q), `(${q[0]}, ${q[1]})`).toBeLessThan(0.6);
        for (const [x, y, rad] of spec.noReeds.circles) expect(Math.hypot(q[0] - x, q[1] - y)).toBeGreaterThan(rad - 0.01);
        for (const [x0, y0, x1, y1] of spec.noReeds.boxes) expect(q[0] > x0 && q[0] < x1 && q[1] > y0 && q[1] < y1).toBe(false);
      }
    }
  });

  it("maillage des roseaux fini et borné (moins de 20 triangles par touffe)", () => {
    const flat: HeightField = { heightAt: () => -25.4, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
    const reeds = structures.flatMap((s) => s.reeds ?? []);
    const mb = new MeshBuilder();
    buildReeds(mb, reeds, flat);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.triangleCount).toBeGreaterThan(reedTufts(reeds) * 10);
    expect(mb.triangleCount).toBeLessThan(reedTufts(reeds) * 20);
    // Rien au-dessus de 1,8 m.
    for (let i = 1; i < mb.positions.length; i += 3) expect(mb.positions[i]!).toBeLessThan(-25.4 + 1.8);
  });

  it("la clôture de la rive est est un grillage vert de 1,8 m", () => {
    const fence = tiles.flatMap(([, t]) => t.walls).find((w) => w.id === 247999124)!;
    expect(fence.look).toBe("mesh");
    expect(fence.height).toBe(1.8);
  });

  it("les arêtes piétonnes du tour ont la largeur du chemin", () => {
    const widths = new Map<number, number>([[223427553, 32], [1525431705, 32], [1548131445, 20], [842375498, 20]]);
    let n = 0;
    for (const id of ["s7_8", "s7_9", "s8_8", "s8_9"]) {
      const e = (JSON.parse(readFileSync(`public/data/nav/${id}.json`, "utf8")) as { ped: { e: number[] } }).ped.e;
      for (let i = 0; i < e.length; i += 11) {
        const w = widths.get(e[i + 8]!);
        if (e[i + 2] === 5 && w !== undefined) {
          expect(e[i + 4]).toBe(w);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(15);
  });
});
