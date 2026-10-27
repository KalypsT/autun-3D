import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pointInRing } from "../core/collision";
import { loadRealWorld } from "../core/testing";

/** Données de navigation (public/data/nav, étape J2) : format, indices, coutures entre super-tuiles, files hors des bâtiments, connexité. */
interface Graph { n: number[]; e: number[]; g: number[]; s?: number[]; r?: number[] }
interface Cell { v: number; id: string; bounds: [number, number, number, number]; ped: Graph; road: Graph; poi: number[] }
interface Index { version: number; cell: number; stride: { ped: { n: number; e: number }; road: { n: number; e: number; s: number; r: number }; poi: number }; poiKinds: string[]; pedTypes: string[]; cells: { id: string; bytes: number }[] }

const read = (name: string): string => readFileSync(`public/data/${name}`, "utf8");
const index = JSON.parse(read("nav/index.json")) as Index;
const cells = new Map<string, Cell>(index.cells.map((c) => [c.id, JSON.parse(read(`nav/${c.id}.json`)) as Cell]));
const { manifest, tile } = loadRealWorld();
const PS = index.stride.ped.e, RS = index.stride.road.e;
const T_LANE = 0, T_CROSS = 2, T_CROSS_IMPLICIT = 4, T_PATH = 5, T_PEDSTREET = 9;

/** Longueur (m) d'une arête piétonne (champ « len » en décimètres). */
const pedEdges = (c: Cell): { a: number; b: number; typ: number; zone: number; foot: number; len: number; ref: number; p0: number; np: number; flags: number }[] => {
  const out = [];
  for (let i = 0; i < c.ped.e.length; i += PS) {
    const [a, b, typ, flags, , foot, zone, len, ref, p0, np] = c.ped.e.slice(i, i + PS) as number[];
    out.push({ a: a!, b: b!, typ: typ!, flags: flags!, foot: foot!, zone: zone!, len: len! / 10, ref: ref!, p0: p0!, np: np! });
  }
  return out;
};

describe("données de navigation (public/data/nav)", () => {
  it("a un fichier par super-tuile du monde, à la taille annoncée, et reste léger", () => {
    const wanted = manifest.super.cells.map((s) => s.id).sort();
    expect([...cells.keys()].sort()).toEqual(wanted);
    const sizes = index.cells.map((c) => [c.bytes, read(`nav/${c.id}.json`).length]);
    expect(sizes.filter(([a, b]) => a !== b)).toEqual([]);
    expect(sizes.reduce((s, [a]) => s + a!, 0)).toBeLessThan(1_500_000);
  });

  it("a des indices valides : nœuds, sommets, types, zones, panneaux, restrictions, points d'intérêt", () => {
    const bad: string[] = [];
    for (const c of cells.values()) {
      const nPed = c.ped.n.length / 3, nRoad = c.road.n.length / 3;
      for (const e of pedEdges(c)) {
        if (e.a >= nPed || e.b >= nPed || e.a === e.b || e.typ >= index.pedTypes.length || e.zone > 3 || e.p0 + e.np > c.ped.g.length / 2) bad.push(`${c.id} ped ${JSON.stringify(e)}`);
      }
      for (let i = 0; i < c.road.e.length; i += RS) {
        const [a, b, cls, flags, lanes, speed, , , gid, p0, np] = c.road.e.slice(i, i + RS) as number[];
        if (a! >= nRoad || b! >= nRoad || cls! > 7 || lanes! < 1 || speed! < 5 || speed! > 130 || gid! <= 0 || p0! + np! > c.road.g.length / 2 || (flags! & 3) === 3) bad.push(`${c.id} road ${i}`);
      }
      const nEdges = c.road.e.length / RS;
      for (let i = 0; i < c.road.s!.length; i += 3) if (c.road.s![i]! >= nRoad || c.road.s![i + 1]! >= nEdges) bad.push(`${c.id} signe ${i}`);
      for (let i = 0; i < c.road.r!.length; i += 3) if (c.road.r![i]! >= nEdges || c.road.r![i + 1]! >= nEdges) bad.push(`${c.id} restriction ${i}`);
      for (let i = 0; i < c.poi.length; i += index.stride.poi) {
        const [k, x, y] = c.poi.slice(i, i + 3) as number[];
        if (k! >= index.poiKinds.length || x! < c.bounds[0] || x! >= c.bounds[2] || y! < c.bounds[1] || y! >= c.bounds[3]) bad.push(`${c.id} poi ${i}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("raccorde les super-tuiles : chaque portail a son jumeau aux mêmes coordonnées dans la voisine, sauf au bord du monde", () => {
    const missing: string[] = [];
    let portals = 0;
    const size = index.cell;
    for (const kind of ["ped", "road"] as const) {
      const has = new Map<string, Set<string>>();
      for (const c of cells.values()) {
        const set = new Set<string>();
        for (let i = 0; i < c[kind].n.length; i += 3) if (c[kind].n[i + 2]! & 1) set.add(`${c[kind].n[i]},${c[kind].n[i + 1]}`);
        has.set(c.id, set);
      }
      for (const c of cells.values()) {
        const [x0, y0] = c.bounds;
        const [ci, cj] = c.id.slice(1).split("_").map(Number) as [number, number];
        for (let i = 0; i < c[kind].n.length; i += 3) {
          const [x, y, f] = c[kind].n.slice(i, i + 3) as number[];
          if (!(f! & 1) || f! & 2) continue;
          portals++;
          const onX = x === x0 || x === x0! + size, onY = y === y0 || y === y0! + size;
          if (onX === onY) continue;
          const nb = `s${ci + (x === x0! + size ? 1 : x === x0 ? -1 : 0)}_${cj + (y === y0! + size ? 1 : y === y0 ? -1 : 0)}`;
          if (!has.get(nb)?.has(`${x},${y}`)) missing.push(`${kind} ${c.id} ${x},${y}`);
        }
      }
    }
    expect(portals).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });

  it("garde les files piétonnes hors des bâtiments (sommets des trottoirs, chemins, rues piétonnes)", () => {
    // Grille de 64 m des emprises de bâtiments, pour ne tester chaque point que contre ses voisins.
    const grid = new Map<string, number[][]>();
    const CELL = 64;
    const key = (i: number, j: number): string => `${i},${j}`;
    for (const b of tile.buildings) {
      const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
      for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
        for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
          const k = key(i, j);
          (grid.get(k) ?? grid.set(k, []).get(k)!).push([...b.ring.slice(0, 0)]);
          grid.get(k)![grid.get(k)!.length - 1] = b.ring;
        }
      }
    }
    const holesOf = new Map<number[], number[][]>(tile.buildings.map((b) => [b.ring, b.holes]));
    let total = 0, inside = 0;
    for (const c of cells.values()) {
      for (const e of pedEdges(c)) {
        if (e.typ !== T_LANE && e.typ !== T_PATH && e.typ !== T_PEDSTREET) continue;
        for (let k = 0; k < e.np; k++) {
          const x = c.ped.g[(e.p0 + k) * 2]!, y = c.ped.g[(e.p0 + k) * 2 + 1]!;
          total++;
          for (const ring of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
            if (pointInRing(x, y, ring) && !(holesOf.get(ring) ?? []).some((h) => pointInRing(x, y, h))) {
              inside++;
              break;
            }
          }
        }
      }
    }
    expect(total).toBeGreaterThan(5000);
    expect(inside / total).toBeLessThan(0.003);
  });

  it("forme un seul réseau piéton : plus de 90 % de la longueur dans la plus grande composante connexe (le reste : chemins coupés au bord du monde)", () => {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    const lengths: [string, number][] = [];
    for (const c of cells.values()) {
      const id = (n: number): string => `${c.ped.n[n * 3]},${c.ped.n[n * 3 + 1]}`;
      for (const e of pedEdges(c)) {
        parent.set(find(id(e.a)), find(id(e.b)));
        lengths.push([id(e.a), e.len]);
      }
    }
    const by = new Map<string, number>();
    for (const [n, len] of lengths) by.set(find(n), (by.get(find(n)) ?? 0) + len);
    const total = [...by.values()].reduce((s, v) => s + v, 0);
    expect(Math.max(...by.values()) / total).toBeGreaterThan(0.9);
  });

  it("place des passages courts entre deux files, reliés à une voie (ref), et des traversées implicites seulement vers des voies calmes", () => {
    const bad: string[] = [];
    let marked = 0;
    for (const c of cells.values()) {
      for (const e of pedEdges(c)) {
        if (e.typ < T_CROSS || e.typ > T_CROSS_IMPLICIT) continue;
        if (e.ref <= 0 || e.len > 30 || e.np !== 0) bad.push(`${c.id} ${JSON.stringify(e)}`);
        if (e.typ !== T_CROSS_IMPLICIT) marked++;
      }
    }
    expect(bad).toEqual([]);
    expect(marked).toBeGreaterThan(300);
  });

  it("donne au graphe routier des feux, des stops, des cédez-le-passage, des sens uniques et des restrictions de virage", () => {
    let signs = 0, restrictions = 0, oneway = 0, signalNodes = 0;
    for (const c of cells.values()) {
      signs += c.road.s!.length / 3;
      restrictions += c.road.r!.length / 3;
      for (let i = 0; i < c.road.e.length; i += RS) if (c.road.e[i + 3]! & 3) oneway++;
      for (let i = 0; i < c.road.n.length; i += 3) if (c.road.n[i + 2]! & 4) signalNodes++;
    }
    expect(signs).toBeGreaterThan(150);
    expect(restrictions).toBeGreaterThan(5);
    expect(oneway).toBeGreaterThan(100);
    expect(signalNodes).toBeGreaterThan(15);
  });
});
