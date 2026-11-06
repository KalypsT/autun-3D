import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeckAxis } from "../core/bridges";
import { Colliders } from "../core/collision";
import { BOAT_TOP, boatOutline } from "../core/piers";
import { createPlayer, HOIST, stepPlayer, SWIM_SINK, type PlayerState } from "../core/player";
import { loadRealWorld } from "../core/testing";
import { CAR, createVehicle, stepVehicle } from "../core/vehicle";
import { buildColliders } from "../core/world";
import { MeshBuilder } from "../render/geometry";
import { buildBoats, buildPier, buildShelters } from "../render/piers";
import type { Deck, TileData, TileStructures } from "./types";

/** D246 : pontons, cale et bateaux du plan d'eau du Vallon (lot 3 de docs/plans/vallon-lac.md), posés par tools/data/build_vallon_piers.py. */
const LAKE = -25.41;
const DT = 1 / 60;
const world = loadRealWorld();
const { terrain } = world;
const colliders = buildColliders(world.tile);
const st = world.tile.structures!;
const piers = st.decks.filter((d) => d.st === "pier");
const byName = (n: string): Deck => piers.find((d) => d.n === n)!;
const axisOf = (d: Deck): DeckAxis => new DeckAxis(d);

/** Marche (ou nage) vers (x, y) ; s'arrête à `tol` m. Renvoie le plus grand écart constaté par `watch`. */
function walkTo(p: PlayerState, x: number, y: number, maxT = 60, tol = 0.4, watch?: (p: PlayerState) => void): void {
  for (let i = 0; i < maxT / DT && Math.hypot(x - p.x, y - p.y) > tol; i++) {
    stepPlayer(p, { forward: 1, right: 0, run: false }, Math.atan2(x - p.x, y - p.y), DT, terrain, colliders);
    watch?.(p);
  }
}

/** Parcourt un ponton de sa rive (premier point) à son bout, en suivant l'axe ; vérifie qu'on reste à pied, sur le tablier. */
function walkAlong(d: Deck, from = 0): PlayerState {
  const a = axisOf(d);
  const start = a.at(from);
  const p = createPlayer(start.x - start.tx * 1.5, start.y - start.ty * 1.5, terrain, Math.atan2(start.tx, start.ty));
  for (let s = from + 1; s <= a.length; s = Math.min(a.length, s + 1)) {
    const q = a.at(s);
    walkTo(p, q.x, q.y, 20, 0.35, (pp) => {
      expect(pp.swim, `${d.n} : on nage à ${s.toFixed(0)} m`).toBe(false);
    });
    if (s === a.length) break;
  }
  return p;
}

describe("pontons du plan d'eau du Vallon (D246)", () => {
  it("sept tabliers `pier` sans parapet : cinq pontons d'OSM, le sixième et la passerelle de son abri", () => {
    expect(piers.map((d) => d.n).sort()).toEqual(["Passerelle sous l'abri", "Ponton de l'abri", "Ponton de l'île", "Ponton de la base", "Ponton de pêche",
      "Ponton de pêche, passerelle", "Ponton du sud-ouest"].sort());
    for (const d of piers) {
      expect(d.k).toBe("foot");
      expect(d.pc).toEqual([]);
      expect(d.id).toBeLessThanOrEqual(-872_000_001);
      // Hauteur au-dessus du lac : 0,3 m flottant, 0,35 (pêche) et 0,45 m (île) sur pieux, hors de la passerelle d'accès depuis la berge.
      const zs = d.p.filter((_, i) => i % 3 === 2);
      const level = zs[zs.length - 1]! - LAKE;
      expect(level).toBeCloseTo(d.fl ? 0.3 : d.n === "Ponton de l'île" ? 0.45 : 0.35, 2);
      expect(Boolean(d.fl)).toBe(d.pl === undefined);
    }
    expect(axisOf(byName("Ponton de pêche")).length).toBeCloseTo(61.6, 0);
    expect(axisOf(byName("Ponton du sud-ouest")).length).toBeGreaterThan(65);
    expect(axisOf(byName("Ponton de l'île")).length).toBeLessThan(15);
    // Le ponton de pêche sur pieux, comme sur la photo ; un pieu au moins tous les 3 m au-dessus de l'eau.
    const fish = byName("Ponton de pêche");
    expect(fish.pl!.length).toBeGreaterThanOrEqual(axisOf(fish).length / 3);
  });

  it("chaque ponton accroché à la rive se parcourt à pied de la berge au bout", () => {
    for (const n of ["Ponton de la base", "Ponton de pêche, passerelle", "Ponton du sud-ouest", "Ponton de l'île", "Passerelle sous l'abri"]) {
      const d = byName(n);
      const p = walkAlong(d);
      const end = axisOf(d).at(axisOf(d).length);
      expect(Math.hypot(p.x - end.x, p.y - end.y), n).toBeLessThan(0.6);
      expect(p.z, n).toBeCloseTo(end.z, 1);
    }
  });

  it("le ponton de pêche se parcourt depuis sa passerelle jusqu'à ses deux bouts ; le ponton de l'abri depuis la passerelle", () => {
    for (const [via, main] of [["Ponton de pêche, passerelle", "Ponton de pêche"], ["Passerelle sous l'abri", "Ponton de l'abri"]] as const) {
      const p = walkAlong(byName(via));
      const a = axisOf(byName(main));
      // Le point du ponton où arrive la passerelle, puis chaque bout, en suivant l'axe (coude compris).
      let s = 0, best = Infinity;
      for (let k = 0; k <= a.length; k += 0.25) {
        const q = a.at(k);
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd < best) [best, s] = [dd, k];
      }
      for (const end of [0, a.length]) {
        for (let k = s; Math.abs(k - end) > 1e-6; k = end > k ? Math.min(end, k + 1) : Math.max(end, k - 1)) {
          const q = a.at(end > k ? Math.min(end, k + 1) : Math.max(end, k - 1));
          walkTo(p, q.x, q.y, 20, 0.35, (pp) => expect(pp.swim, main).toBe(false));
        }
        const q = a.at(end);
        expect(Math.hypot(p.x - q.x, p.y - q.y), `${main} à ${end}`).toBeLessThan(0.6);
        expect(p.z).toBeCloseTo(q.z, 1);
        s = end;
      }
    }
  });

  it("depuis l'eau, un nageur monte sur un ponton flottant (0,3 m) et se hisse sur le ponton fixe de pêche (0,35 m)", () => {
    expect(HOIST).toBeGreaterThan(0.45);
    for (const [n, s, side] of [["Ponton de la base", 20, -1], ["Ponton du sud-ouest", 40, 1], ["Ponton de l'abri", 10, -1], ["Ponton de pêche", 30, 1]] as const) {
      const d = byName(n);
      const a = axisOf(d).at(s);
      const nx = -a.ty * side, ny = a.tx * side;
      const p = createPlayer(a.x + nx * 5, a.y + ny * 5, terrain);
      expect(p.swim, `${n} : départ à la nage`).toBe(true);
      walkTo(p, a.x, a.y, 15, 0.3);
      for (let i = 0; i < 2 / DT; i++) stepPlayer(p, { forward: 0, right: 0, run: false }, 0, DT, terrain, colliders);
      expect(p.swim, n).toBe(false);
      expect(p.climb, n).toBe(null);
      expect(p.z, n).toBeCloseTo(a.z, 1);
    }
  });

  it("le ponton de l'île, dans le marais peu profond du sud (0,4 m, D240), se rejoint en marchant dans l'eau", () => {
    const a = axisOf(byName("Ponton de l'île")).at(9);
    const p = createPlayer(a.x + 6, a.y, terrain);
    expect(p.swim).toBe(false);
    walkTo(p, a.x, a.y, 15, 0.3);
    for (let i = 0; i < 2 / DT; i++) stepPlayer(p, { forward: 0, right: 0, run: false }, 0, DT, terrain, colliders);
    expect(p.z).toBeCloseTo(a.z, 1);
  });

  it("un nageur sous le ponton fixe de pêche ou le long de ses pieux n'y reste jamais coincé", () => {
    const d = byName("Ponton de pêche");
    const a = axisOf(d).at(30);
    // Placé de force sous le tablier : il en sort (sur le tablier) dès qu'il nage.
    const p = createPlayer(a.x + 5, a.y, terrain);
    expect(p.swim).toBe(true);
    p.x = a.x; p.y = a.y; p.z = LAKE - SWIM_SINK;
    for (let i = 0; i < 4 / DT; i++) stepPlayer(p, { forward: 1, right: 0, run: false }, Math.PI / 2, DT, terrain, colliders);
    expect(p.swim && Math.abs(p.x - a.x) < 1 && p.z < LAKE).toBe(false);
    // Le long du ponton, côté large, sans s'y diriger : il avance.
    const q = createPlayer(a.x + 1.8, a.y + 6, terrain);
    expect(q.swim).toBe(true);
    const y0 = q.y;
    for (let i = 0; i < 8 / DT; i++) stepPlayer(q, { forward: 1, right: 0, run: false }, Math.PI, DT, terrain, colliders);
    expect(y0 - q.y).toBeGreaterThan(5);
    expect(q.swim).toBe(true);
  });

  it("dessin : planches, flotteurs sous les pontons flottants, pieux jusqu'au fond ; fini et borné", () => {
    const bare = terrain.ground;
    for (const d of piers) {
      const mb = new MeshBuilder();
      buildPier(mb, d, bare);
      const pos = mb.positions;
      expect(pos.every(Number.isFinite)).toBe(true);
      const tris = pos.length / 9;
      const L = axisOf(d).length;
      // Planches tous les 16 cm (2 triangles) ; rives, dessous, flotteurs ou pieux : moins de 40 triangles par mètre.
      expect(tris, d.n).toBeGreaterThan(L * 10);
      expect(tris, d.n).toBeLessThan(L * 40);
      const ys = pos.filter((_, i) => i % 3 === 1);
      const deckZ = d.p[d.p.length - 1]!;
      if (d.fl) expect(Math.min(...ys), d.n).toBeLessThan(LAKE);
      else expect(Math.min(...ys), d.n).toBeLessThan(LAKE - 0.3);
      expect(Math.max(...ys), d.n).toBeLessThanOrEqual(Math.max(deckZ, d.p[2]!) + 0.01);
    }
  });
});

describe("la cale de la base nautique (D246)", () => {
  const tile = JSON.parse(readFileSync("public/data/tiles/31_37.json", "utf8")) as TileData;
  const ring = tile.ground["slipway"]![0]![0]!;

  it("une dalle de béton d'environ 100 m² sur la rampe du relief, qui entre dans l'eau", () => {
    let area = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) area += ring[j]! * ring[i + 1]! - ring[i]! * ring[j + 1]!;
    expect(Math.abs(area / 2)).toBeGreaterThan(80);
    expect(Math.abs(area / 2)).toBeLessThan(130);
    // Pente mesurée le long de la cale (d'est en ouest) : douce, de 0,1 à 0,2.
    const z = (x: number): number => terrain.groundAt(x, 607.5);
    expect((z(1314) - z(1308)) / 6).toBeGreaterThan(0.1);
    expect((z(1314) - z(1308)) / 6).toBeLessThan(0.2);
    expect(z(1302)).toBeLessThan(LAKE);
    // L'eau monte jusqu'au pied de la cale (contour d'OSM prolongé, `water.extend`).
    expect(terrain.waterAt(1302, 607.5)).toBeCloseTo(LAKE, 2);
    expect(terrain.waterAt(1305.5, 605)).toBeCloseTo(LAKE, 2);
  });

  it("on sort de l'eau à pied par la cale", () => {
    const p = createPlayer(1289, 606.5, terrain);
    expect(p.swim).toBe(true);
    walkTo(p, 1316, 607.5, 40, 0.5);
    expect(p.swim).toBe(false);
    expect(p.x).toBeGreaterThan(1315);
    expect(p.z - LAKE).toBeGreaterThan(1);
  });

  it("une voiture qui descend la cale entre dans la darse et coule (D242)", () => {
    const s = createVehicle(1320, 607.5, -Math.PI / 2, terrain);
    let sank = false;
    for (let i = 0; i < 25 / DT; i++) {
      stepVehicle(s, CAR, s.drowned ? { throttle: 0, brake: 0, steer: 0 } : { throttle: 0.5, brake: 0, steer: 0 }, DT, terrain, new Colliders(), null, true, true);
      if (s.sink) sank = true;
    }
    expect(s.drowned).toBe(true);
    expect(sank).toBe(true);
    expect(s.x).toBeLessThan(1300);
    expect(s.z).toBeLessThan(LAKE - 1);
  });
});

describe("bateaux et abri (D246)", () => {
  const boats = st.boats ?? [];

  it("29 bateaux : 27 posés sur le quai de la darse, hors de l'eau, et 2 amarrés au ponton de la base", () => {
    expect(boats.length).toBe(29);
    const moored = boats.filter((b) => b.z < LAKE);
    expect(moored.length).toBe(2);
    for (const b of boats) {
      if (b.z < LAKE) expect(terrain.groundAt(b.x, b.y)).toBeLessThan(LAKE - 0.6);
      else expect(b.z).toBeGreaterThanOrEqual(LAKE);
      expect(b.l).toBeGreaterThan(2);
      expect(b.l).toBeLessThan(5);
      // Aucun bateau sur un ponton.
      for (const d of piers) {
        const a = axisOf(d);
        for (let s = 0; s <= a.length; s += 0.5) {
          const q = a.at(s);
          expect(Math.hypot(q.x - b.x, q.y - b.y) > d.w / 2 + 0.4 || Math.abs(q.z - b.z) > 2).toBe(true);
        }
      }
    }
    expect(boats.filter((b) => b.m).length).toBe(1);
  });

  it("les bateaux et les poteaux de l'abri sont des obstacles ; on enjambe un bateau", () => {
    const b = boats[5]!;
    const r = boatOutline(b);
    expect(r.length).toBeGreaterThanOrEqual(10);
    // Au bord de la coque, sur le flanc : repoussé ; en sautant plus haut que le bateau : rien.
    const fx = b.x - Math.sin(b.a) * (b.w / 2 + 0.1), fy = b.y + Math.cos(b.a) * (b.w / 2 + 0.1);
    expect(colliders.resolve(fx, fy, 0.3, 0).hit).toBe(true);
    expect(colliders.resolve(fx, fy, 0.3, BOAT_TOP + 0.05).hit).toBe(false);
    const sh = st.shelters![0]!;
    expect(sh.z - LAKE).toBeCloseTo(3, 1);
    // Sous l'abri, la passerelle est libre.
    const a = axisOf(byName("Passerelle sous l'abri"));
    for (let s = 0; s <= a.length; s += 0.5) expect(colliders.resolve(a.at(s).x, a.at(s).y, 0.3, 0).hit).toBe(false);
  });

  it("dessin des bateaux et de l'abri : fini et borné", () => {
    const mb = new MeshBuilder();
    buildBoats(mb, boats);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(boats.length * 200);
    const ms = new MeshBuilder();
    buildShelters(ms, st.shelters!, terrain.ground);
    expect(ms.positions.every(Number.isFinite)).toBe(true);
    expect(ms.positions.length / 9).toBeLessThan(200);
  });

  it("les données des ouvrages ne portent les bateaux et l'abri que dans la tuile de la base", () => {
    const of = (id: string): TileStructures => JSON.parse(readFileSync(`public/data/structures/${id}.json`, "utf8")) as TileStructures;
    expect(of("31_37").boats?.length).toBe(29);
    expect(of("31_37").shelters?.length).toBe(1);
    for (const id of ["30_35", "30_36", "31_35"]) expect(of(id).boats).toBeUndefined();
  });
});
