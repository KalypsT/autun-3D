import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeckAxis } from "../core/bridges";
import { EQUIP_TOP, equipRing, skateSides } from "../core/leisure";
import { createPlayer, stepPlayer, type PlayerState } from "../core/player";
import { loadRealWorld } from "../core/testing";
import { buildColliders } from "../core/world";
import { MeshBuilder } from "../render/geometry";
import { buildEquip, buildLeisureDeck } from "../render/leisure";
import type { Deck, TileData } from "./types";

/** D247 : équipements du plan d'eau du Vallon (lot 4 de docs/plans/vallon-lac.md), posés par tools/data/build_vallon_leisure.py. */
const DT = 1 / 60;
const world = loadRealWorld();
const { terrain } = world;
const colliders = buildColliders(world.tile);
const st = world.tile.structures!;
const skate = st.decks.filter((d) => d.st === "skate");
const pump = st.decks.filter((d) => d.st === "pump");
const equip = st.equip ?? [];
const byName = (n: string): Deck => skate.find((d) => d.n === n)!;
const zs = (d: Deck): number[] => d.p.filter((_, i) => i % 3 === 2);
type P = [number, number];
const paths = (JSON.parse(readFileSync("tools/data/vallon_path.json", "utf8")) as { paths: { name: string; w: number; p: number[] }[] }).paths
  .map((p) => ({ w: p.w, line: p.p.flatMap((v, i) => (i % 2 === 0 ? [[v, p.p[i + 1]!] as P] : [])) }));
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** Distance au bord du chemin du tour (négative : sur le chemin). */
const pathEdge = (p: P): number => Math.min(...paths.map(({ w, line }) => Math.min(...line.slice(1).map((b, i) => segDist(p, line[i]!, b))) - w / 2));

function walkTo(p: PlayerState, x: number, y: number, maxT = 20, watch?: (p: PlayerState) => void): void {
  for (let i = 0; i < maxT / DT && Math.hypot(x - p.x, y - p.y) > 0.3; i++) {
    stepPlayer(p, { forward: 1, right: 0, run: false }, Math.atan2(x - p.x, y - p.y), DT, terrain, colliders);
    watch?.(p);
  }
}

describe("skatepark et pump track (D247)", () => {
  it("cinq modules et trois boucles de pump track, en tabliers piétons sans parapet", () => {
    expect(skate.map((d) => d.n).sort()).toEqual(["Bloc ouest", "Bloc sud", "Funbox du milieu", "Quarter nord-ouest", "Quarter sud-est"]);
    expect(pump.length).toBe(3);
    for (const d of [...skate, ...pump]) {
      expect(d.k).toBe("foot");
      expect(d.pc).toEqual([]);
      expect(d.id).toBeLessThanOrEqual(-873_000_001);
      expect(d.id).toBeGreaterThan(-874_000_000);
    }
    const rise = (d: Deck): number => Math.max(...zs(d)) - terrain.groundAt(new DeckAxis(d).at(new DeckAxis(d).length / 2).x, new DeckAxis(d).at(new DeckAxis(d).length / 2).y);
    // Hauteurs des bosses mesurées au LiDAR sur la dalle.
    expect(rise(byName("Quarter nord-ouest"))).toBeCloseTo(0.8, 1);
    expect(rise(byName("Funbox du milieu"))).toBeCloseTo(1.0, 1);
    expect(rise(byName("Bloc ouest"))).toBeCloseTo(0.4, 0);
    // Tous les modules tiennent sur la dalle du skatepark (contour OSM).
    const tile = JSON.parse(readFileSync("public/data/tiles/31_37.json", "utf8")) as TileData;
    const slab = tile.ground["skate"]![0]![0]!;
    const inSlab = (x: number, y: number): boolean => {
      let inside = false;
      for (let i = 0, j = slab.length - 2; i < slab.length; j = i, i += 2) {
        if (slab[i + 1]! > y !== slab[j + 1]! > y && x < ((slab[j]! - slab[i]!) * (y - slab[i + 1]!)) / (slab[j + 1]! - slab[i + 1]!) + slab[i]!) inside = !inside;
      }
      return inside;
    };
    for (const d of skate) {
      const r = skateSides(d).ring;
      for (let i = 0; i < r.length; i += 2) expect(inSlab(r[i]!, r[i + 1]!), d.n).toBe(true);
    }
    // Pump track : 140 à 190 m d'enrobé, à une dizaine de centimètres au-dessus du relief, qui porte les bosses de la piste (LiDAR : plus de 0,3 m d'écart sur chaque boucle).
    let L = 0;
    for (const d of pump) {
      const a = new DeckAxis(d);
      L += a.length;
      const above = a.cum.map((s) => { const q = a.at(s); return q.z - terrain.groundAt(q.x, q.y); });
      expect(Math.min(...above)).toBeGreaterThan(0.02);
      // Au plus 0,7 m, au bord d'une bosse raide (les flancs descendent jusqu'au relief).
      expect(Math.max(...above)).toBeLessThan(0.7);
      const z = a.cum.map((s) => a.at(s).z);
      expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(0.3);
    }
    expect(L).toBeGreaterThan(140);
    expect(L).toBeLessThan(190);
  });

  it("on monte la funbox à pied, on passe le plateau et on redescend ; on monte le quarter jusqu'à son rebord", () => {
    const f = new DeckAxis(byName("Funbox du milieu"));
    const g = terrain.groundAt(f.at(f.length / 2).x, f.at(f.length / 2).y);
    const a0 = f.at(0);
    const p = createPlayer(a0.x - a0.tx * 1.5, a0.y - a0.ty * 1.5, terrain);
    let top = -Infinity;
    for (const s of [0, f.length / 2, f.length]) {
      const q = f.at(s);
      walkTo(p, q.x, q.y, 10, (pp) => { top = Math.max(top, pp.z); });
    }
    const end = f.at(f.length);
    walkTo(p, end.x + end.tx * 1.5, end.y + end.ty * 1.5);
    expect(top - g).toBeGreaterThan(0.5);
    expect(Math.hypot(p.x - end.x - end.tx * 1.5, p.y - end.y - end.ty * 1.5)).toBeLessThan(0.5);
    expect(p.z - g).toBeLessThan(0.15);

    const qa = new DeckAxis(byName("Quarter nord-ouest"));
    const q0 = qa.at(0), q1 = qa.at(qa.length - 0.3);
    const p2 = createPlayer(q0.x - q0.tx * 1.5, q0.y - q0.ty * 1.5, terrain);
    walkTo(p2, q1.x, q1.y, 10);
    expect(p2.z).toBeCloseTo(q1.z, 1);
  });

  it("on bute sur le flanc d'un bloc et sur l'arrière d'un quarter ; en haut du bloc, on en passe le bord", () => {
    const b = new DeckAxis(byName("Bloc ouest"));
    const m = b.at(b.length / 2);
    const g = terrain.groundAt(m.x, m.y);
    const side = byName("Bloc ouest").w / 2 + 0.2;
    const sx = m.x - m.ty * side, sy = m.y + m.tx * side;
    expect(colliders.resolve(sx, sy, 0.3, 0, g).hit).toBe(true);
    expect(colliders.resolve(sx, sy, 0.3, 0, m.z).hit).toBe(false);
    const qa = new DeckAxis(byName("Quarter nord-ouest"));
    const back = qa.at(qa.length);
    expect(colliders.resolve(back.x + back.tx * 0.2, back.y + back.ty * 0.2, 0.3, 0, terrain.groundAt(back.x, back.y)).hit).toBe(true);
  });

  it("le long d'une boucle de pump track, on suit ses bosses à pied", () => {
    const a = new DeckAxis(pump[0]!);
    const s0 = a.at(2);
    const p = createPlayer(s0.x, s0.y, terrain);
    const seen: number[] = [];
    for (let s = 3; s < 30; s += 1) {
      const q = a.at(s);
      walkTo(p, q.x, q.y, 5, (pp) => seen.push(pp.z));
      expect(p.z - terrain.groundAt(p.x, p.y)).toBeGreaterThan(0.02);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.3);
  });

  it("dessin des modules et du pump track : fini et borné", () => {
    for (const d of [...skate, ...pump]) {
      const mb = new MeshBuilder();
      buildLeisureDeck(mb, d, terrain.ground);
      expect(mb.positions.every(Number.isFinite), d.n).toBe(true);
      expect(mb.positions.length / 9, d.n).toBeGreaterThan(4);
      expect(mb.positions.length / 9, d.n).toBeLessThan(new DeckAxis(d).length * 12 + 40);
    }
  });
});

describe("aire de jeux, agrès, panneaux, clôtures, gué (D247)", () => {
  const items = equip.filter((e) => e.x !== undefined);
  const lines = equip.filter((e) => e.p);

  it("25 équipements : 2 structures de jeux, 2 jeux à ressort, banc, 3 tables, 3 agrès, 3 panneaux, 5 pierres, barre, 2 grillages, 2 ganivelles, rigole", () => {
    const count = (k: string): number => equip.filter((e) => e.k === k).length;
    expect(equip.length).toBe(25);
    expect([count("play_small"), count("play_big"), count("springer"), count("bench"), count("picnic"), count("fitness"), count("board"), count("stone")]).toEqual([1, 1, 2, 1, 3, 3, 3, 5]);
    expect([count("rail"), count("fence"), count("ganivelle"), count("brook")]).toEqual([1, 2, 2, 1]);
  });

  it("tous les objets posés sont hors du chemin du tour (à plus de 0,5 m de son bord), hors des lampadaires et des pontons", () => {
    const lamps = world.tile.furniture.filter((f) => f.kind === "street_lamp");
    for (const e of items) {
      if (e.k === "stone") continue;
      const r = equipRing(e);
      for (let i = 0; i < r.length; i += 2) expect(pathEdge([r[i]!, r[i + 1]!]), e.n).toBeGreaterThan(0.5);
      for (const l of lamps) expect(Math.hypot(l.x - e.x!, l.y - e.y!), `${e.n} / lampadaire ${l.id}`).toBeGreaterThan(1.0);
      for (const d of st.decks.filter((q) => q.st === "pier")) {
        const a = new DeckAxis(d);
        for (let s = 0; s <= a.length; s += 1) expect(Math.hypot(a.at(s).x - e.x!, a.at(s).y - e.y!)).toBeGreaterThan(3);
      }
    }
    // Les clôtures ne coupent pas le chemin.
    for (const e of lines.filter((q) => q.k !== "brook" && q.k !== "rail")) {
      for (let i = 0; i + 3 < e.p!.length; i += 2) {
        for (let t = 0; t <= 1; t += 0.1) {
          const x = e.p![i]! + (e.p![i + 2]! - e.p![i]!) * t, y = e.p![i + 1]! + (e.p![i + 3]! - e.p![i + 1]!) * t;
          expect(pathEdge([x, y]), e.n).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it("les pierres du gué enjambent la rigole du Brisecou, entre les deux bouts de l'allée Émile Château", () => {
    const stones = items.filter((e) => e.k === "stone");
    const brook = lines.find((e) => e.k === "brook")!;
    const near = stones.map((s) => Math.min(...Array.from({ length: brook.p!.length / 2 - 1 }, (_, i) =>
      segDist([s.x!, s.y!], [brook.p![2 * i]!, brook.p![2 * i + 1]!], [brook.p![2 * i + 2]!, brook.p![2 * i + 3]!]))));
    expect(Math.min(...near)).toBeLessThan(0.5);
    for (let i = 1; i < stones.length; i++) expect(Math.hypot(stones[i]!.x! - stones[i - 1]!.x!, stones[i]!.y! - stones[i - 1]!.y!)).toBeLessThan(1.8);
    // Les deux bouts de l'allée (OSM) : de part et d'autre du gué.
    expect(Math.hypot(stones[0]!.x! - 1350.6, stones[0]!.y! - 19.1)).toBeLessThan(3.5);
    expect(Math.hypot(stones[stones.length - 1]!.x! - 1349.0, stones[stones.length - 1]!.y! - 20.9)).toBeLessThan(3.5);
  });

  it("obstacles : les structures de jeux arrêtent ; bancs, tables, agrès et ganivelle s'enjambent", () => {
    for (const e of items) {
      if (e.k === "stone") continue;
      // Au milieu d'un grand côté, à 15 cm du bord.
      const a = e.a ?? 0, hw = equipRing(e).length ? Math.hypot(equipRing(e)[6]! - equipRing(e)[0]!, equipRing(e)[7]! - equipRing(e)[1]!) / 2 : 0;
      const px = e.x! - Math.sin(a) * (hw + 0.15), py = e.y! + Math.cos(a) * (hw + 0.15);
      expect(colliders.resolve(px, py, 0.3, 0).hit, e.n).toBe(true);
      if (EQUIP_TOP[e.k] !== undefined) expect(colliders.resolve(px, py, 0.3, EQUIP_TOP[e.k]! + 0.05).hit, e.n).toBe(false);
    }
    const g = lines.find((e) => e.k === "ganivelle")!;
    const mx = (g.p![0]! + g.p![2]!) / 2, my = (g.p![1]! + g.p![3]!) / 2;
    expect(colliders.resolve(mx, my, 0.3, 0).hit).toBe(true);
    expect(colliders.resolve(mx, my, 0.3, 1.2).hit).toBe(false);
  });

  it("dessin des équipements : fini et borné", () => {
    const mb = new MeshBuilder();
    buildEquip(mb, equip, terrain.ground);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    // Lattes de ganivelle et fils du grillage compris : moins de 25 000 triangles.
    expect(mb.positions.length / 9).toBeLessThan(25000);
    expect(mb.positions.length / 9).toBeGreaterThan(1000);
  });

  it("sols : dalle du skatepark (environ 640 m²), gravillons (environ 500 m²) et sol souple de l'aire de jeux", () => {
    const area = (r: readonly number[]): number => {
      let a = 0;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
      return Math.abs(a / 2);
    };
    const t1 = JSON.parse(readFileSync("public/data/tiles/31_37.json", "utf8")) as TileData;
    const t2 = JSON.parse(readFileSync("public/data/tiles/32_35.json", "utf8")) as TileData;
    expect(area(t1.ground["skate"]![0]![0]!)).toBeGreaterThan(560);
    expect(area(t1.ground["skate"]![0]![0]!)).toBeLessThan(720);
    expect(area(t2.ground["play_gravel"]![0]![0]!)).toBeGreaterThan(400);
    expect(area(t2.ground["play_gravel"]![0]![0]!)).toBeLessThan(620);
    expect(area(t2.ground["play_mat"]![0]![0]!)).toBeGreaterThan(25);
  });
});
