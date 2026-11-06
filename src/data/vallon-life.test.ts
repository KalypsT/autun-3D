import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeckAxis } from "../core/bridges";
import { EQUIP_TOP, equipRing } from "../core/leisure";
import { routeAt, SAIL_SPEED, sailCount, sailPoses } from "../core/sailing";
import { loadRealWorld } from "../core/testing";
import { crowdVallon } from "../core/week";
import { buildColliders } from "../core/world";
import { MeshBuilder } from "../render/geometry";
import { buildEquip } from "../render/leisure";
import { buildTallGrass, tallGrassPoints } from "../render/reeds";

/** D249 : la vie du plan d'eau du Vallon (lot 5 de docs/plans/vallon-lac.md), posée par tools/data/build_vallon_life.py. */
const LAKE = -25.41;
const world = loadRealWorld();
const { terrain } = world;
const colliders = buildColliders(world.tile);
const st = world.tile.structures!;
const life = st.life ?? [];
const routes = st.sail ?? [];
const tall = st.tall ?? [];
type P = [number, number];
const paths = (JSON.parse(readFileSync("tools/data/vallon_path.json", "utf8")) as { paths: { w: number; p: number[] }[] }).paths
  .map((p) => ({ w: p.w, line: p.p.flatMap((v, i) => (i % 2 === 0 ? [[v, p.p[i + 1]!] as P] : [])) }));
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const pathEdge = (p: P): number => Math.min(...paths.map(({ w, line }) => Math.min(...line.slice(1).map((b, i) => segDist(p, line[i]!, b))) - w / 2));
const inWater = (x: number, y: number): boolean => terrain.waterAt(x, y) !== undefined && terrain.waterAt(x, y)! - terrain.groundAt(x, y) > 0.05;

describe("pêcheurs du plan d'eau du Vallon (D249)", () => {
  it("quatre biwys et quatre pêcheurs en trois groupes, hors du chemin, au bord de l'eau, tournés vers elle", () => {
    const count = (k: string): number => life.filter((e) => e.k === k).length;
    expect([count("bivvy"), count("angler"), count("rodpod")]).toEqual([4, 4, 5]);
    for (const e of life) {
      const on = e.z !== undefined;
      if (!on) {
        const r = equipRing(e);
        for (let i = 0; i < r.length; i += 2) expect(pathEdge([r[i]!, r[i + 1]!]), e.n).toBeGreaterThan(0.3);
        expect(inWater(e.x!, e.y!), e.n).toBe(false);
      }
      // Devant (le long de `a`), l'eau est à moins de 9 m (biwy à 5 m de l'eau, cannes au bord).
      const ahead = Array.from({ length: 19 }, (_, k) => k * 0.5).some((d) => inWater(e.x! + Math.cos(e.a!) * d, e.y! + Math.sin(e.a!) * d));
      expect(ahead, `${e.k} ${e.n}`).toBe(true);
    }
  });

  it("le pêcheur du ponton de pêche est assis sur son tablier", () => {
    const a = life.find((e) => e.k === "angler" && e.z !== undefined)!;
    expect(a.z! - LAKE).toBeCloseTo(0.35, 2);
    expect(terrain.heightAt(a.x!, a.y!, a.z!)).toBeCloseTo(a.z!, 2);
    const pier = st.decks.find((d) => d.n === "Ponton de pêche")!;
    const ax = new DeckAxis(pier);
    let best = Infinity;
    for (let s = 0; s <= ax.length; s += 0.25) best = Math.min(best, Math.hypot(ax.at(s).x - a.x!, ax.at(s).y - a.y!));
    expect(best).toBeLessThan(pier.w / 2);
  });

  it("biwys, cannes et pêcheurs sont des obstacles bas ; dessin fini et borné", () => {
    for (const e of life) {
      const hw = Math.hypot(equipRing(e)[6]! - equipRing(e)[0]!, equipRing(e)[7]! - equipRing(e)[1]!) / 2;
      const px = e.x! - Math.sin(e.a!) * (hw + 0.15), py = e.y! + Math.cos(e.a!) * (hw + 0.15);
      expect(colliders.resolve(px, py, 0.3, 0, e.z).hit, `${e.k} ${e.n}`).toBe(true);
      // En sautant plus haut que le plus haut d'entre eux (le biwy voisin peut être tout près), plus rien.
      expect(colliders.resolve(px, py, 0.3, Math.max(EQUIP_TOP.bivvy!, EQUIP_TOP.angler!, EQUIP_TOP.rodpod!) + 0.05, e.z).hit).toBe(false);
    }
    const mb = new MeshBuilder();
    buildEquip(mb, life, terrain.ground);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(life.length * 400);
  });
});

describe("voiliers du plan d'eau du Vallon (D249)", () => {
  it("trois boucles, toutes dans l'eau navigable : au moins 1,2 m de fond et 12 m d'eau tout autour", () => {
    expect(routes.length).toBe(3);
    for (const r of routes) {
      for (let i = 0; i < r.p.length; i += 2) {
        const x = r.p[i]!, y = r.p[i + 1]!;
        expect(terrain.waterAt(x, y), r.n).toBeCloseTo(LAKE, 2);
        expect(LAKE - terrain.groundAt(x, y), r.n).toBeGreaterThan(1.2);
        for (let k = 0; k < 8; k++) expect(terrain.waterAt(x + 12 * Math.cos(k * Math.PI / 4), y + 12 * Math.sin(k * Math.PI / 4)), r.n).toBeDefined();
      }
    }
  });

  it("l'été en journée (trois en semaine, cinq le week-end), deux le week-end au printemps et en automne, jamais l'hiver ni la nuit", () => {
    expect(sailCount(1, 12, 2)).toBe(3);
    expect(sailCount(1, 12, 6)).toBe(5);
    expect(sailCount(1, 22, 6)).toBe(0);
    expect(sailCount(1, 8, 2)).toBe(0);
    expect(sailCount(0, 15, 6)).toBe(2);
    expect(sailCount(2, 15, 1)).toBe(0);
    expect(sailCount(3, 14, 6)).toBe(0);
  });

  it("les voiliers avancent le long de leurs boucles à 1,6 m/s, cap dans le sens de la marche, toujours sur l'eau", () => {
    for (let t = 0; t < 900; t += 37) {
      const a = sailPoses(routes, t, 1, 14, 6), b = sailPoses(routes, t + 5, 1, 14, 6);
      expect(a.length).toBe(5);
      a.forEach((p, k) => {
        expect(terrain.waterAt(p.x, p.y)).toBeCloseTo(LAKE, 2);
        const q = b[k]!;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        expect(d).toBeGreaterThan(SAIL_SPEED * 5 * 0.85);
        expect(d).toBeLessThan(SAIL_SPEED * 5 * 1.01);
        // Le cap regarde vers la position suivante.
        expect(Math.cos(p.a) * (q.x - p.x) + Math.sin(p.a) * (q.y - p.y)).toBeGreaterThan(0);
      });
    }
    expect(routeAt([0, 0, 10, 0, 10, 10, 0, 10], 15)).toMatchObject({ x: 10, y: 5, length: 40 });
  });
});

describe("herbes hautes du sud et promeneurs (D249)", () => {
  it("herbes hautes : jamais sur le chemin ni dans l'eau, un budget borné", () => {
    const pts = tallGrassPoints(tall);
    expect(pts.length).toBeGreaterThan(800);
    expect(pts.length).toBeLessThan(3000);
    for (const [x, y] of pts) {
      expect(pathEdge([x, y])).toBeGreaterThan(1.2);
      expect(inWater(x, y)).toBe(false);
    }
    const mb = new MeshBuilder();
    buildTallGrass(mb, tall, terrain.ground);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    // Quatre à cinq lames dessinées des deux côtés par touffe.
    expect(mb.positions.length / 9).toBeLessThanOrEqual(pts.length * 10);
  });

  it("le tour du lac attire les promeneurs, surtout le week-end et l'été en fin de journée", () => {
    expect(crowdVallon(2, 11, 1, 0, 0)).toBe(1);
    expect(crowdVallon(2, 11, 1, 1200, 300)).toBeCloseTo(1.5, 5);
    expect(crowdVallon(6, 15, 0, 1200, 300)).toBeCloseTo(2.4, 5);
    expect(crowdVallon(2, 19, 1, 1200, 300)).toBeCloseTo(1.95, 5);
    expect(crowdVallon(2, 11, 3, 1200, 300)).toBeCloseTo(1.05, 5);
  });
});
