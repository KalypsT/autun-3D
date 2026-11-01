import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingKind, HeightField, TileData, TileKinds, VallonModel } from "../data/types";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildVallon, clipStrip, gymRoofZ, rectCorners, vallonFrame, VALLON_PARAPET } from "./vallon";

/** D172 : collège du Vallon, lot 1 de docs/plans/college-vallon.md : volumes et toits mesurés au LiDAR (§9). */
const MAIN = "BATIMENT0000000348848973", PREAU = "BATIMENT0000000348848974", GYM = "BATIMENT0000000348848924", WEST = "BATIMENT0000000348849004";
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
const tile = JSON.parse(readFileSync("public/data/tiles/28_39.json", "utf8")) as TileData;
const main = kinds.buildings[MAIN]!.vallon as VallonModel;
const preau = kinds.buildings[PREAU]!.vallon as VallonModel;
const gym = kinds.buildings[GYM]!.vallon as VallonModel;
const ground = (id: string): number => tile.buildings.find((b) => b.id === id)!.ground;

const ringOf = (id: string): [number, number][] => {
  const r = tile.buildings.find((b) => b.id === id)!.ring;
  return Array.from({ length: r.length / 2 }, (_, i) => [r[2 * i]!, r[2 * i + 1]!]);
};
const inside = (p: [number, number], poly: [number, number][]): boolean => {
  let c = false;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  });
  return c;
};
const distToRing = (p: [number, number], poly: [number, number][]): number =>
  Math.min(...poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }));

const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas: {} as SignAtlas });
const flatAt = (z: number): HeightField => ({ heightAt: () => z, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 });
const triangles = (s: LandmarkSinks): number => s.solid.positions.length / 9;
const topOf = (s: LandmarkSinks): number => Math.max(...s.solid.positions.filter((_, i) => i % 3 === 1));

describe("Collège du Vallon (D172) : modèle de données", () => {
  it("les trois bâtiments sont des écoles et portent chacun leur partie du modèle ; le type « culture » du bloc principal a disparu", () => {
    expect(kinds.buildings[MAIN]!.k).toBe("school");
    expect(kinds.buildings[PREAU]!.k).toBe("school");
    expect(kinds.buildings[GYM]!.k).toBe("school");
    expect(main.wings).toHaveLength(6);
    expect(preau.preau).toBeDefined();
    expect(gym.gym).toBeDefined();
  });

  it("repère tourné de 17,5° : le cap de u est 72°, celui de v 342° ; aller-retour exact", () => {
    const f = vallonFrame(main);
    const [x, y] = f.pt(10, 0), [x0, y0] = f.pt(0, 0);
    expect(((Math.atan2(x - x0, y - y0) * 180) / Math.PI + 360) % 360).toBeCloseTo(72.5, 1);
    const [xv, yv] = f.pt(0, 10);
    expect(((Math.atan2(xv - x0, yv - y0) * 180) / Math.PI + 360) % 360).toBeCloseTo(342.5, 1);
    const [u, v] = f.uv(f.pt(7.3, -4.1));
    expect(u).toBeCloseTo(7.3, 9);
    expect(v).toBeCloseTo(-4.1, 9);
    expect(Math.hypot(x - x0, y - y0)).toBeCloseTo(10, 9);
  });

  it("toits des ailes mesurés au LiDAR : barre à 12,7 m du sol (quatre niveaux), ailes ouest et nord vers 8 m, préau à 3,8 m", () => {
    const g = ground(MAIN);
    const z = (n: string): number => main.wings!.find((w) => w.n === n)!.z - g;
    expect(z("barre")).toBeGreaterThan(12.2);
    expect(z("barre")).toBeLessThan(13.2);
    expect(z("aile-ouest")).toBeGreaterThan(7.6);
    expect(z("aile-ouest")).toBeLessThan(8.6);
    expect(z("aile-est")).toBeGreaterThan(z("aile-ouest"));
    expect(z("cage-est")).toBeLessThan(z("barre"));
    expect(preau.preau!.crown - ground(PREAU)).toBeGreaterThan(3.4);
    expect(preau.preau!.crown - ground(PREAU)).toBeLessThan(4.3);
    expect(preau.preau!.eave).toBeLessThan(preau.preau!.crown);
  });

  it("chaque aile est dans l'emprise du bâtiment BD TOPO, à 3 m près (les collisions gardent cette emprise)", () => {
    const ring = ringOf(MAIN), f = vallonFrame(main);
    for (const w of main.wings!) {
      if (w.n === "cage-est") continue; // l'escalier extérieur est hors de l'emprise
      for (const c of rectCorners(f, w.r)) expect(inside(c, ring) || distToRing(c, ring) < 3, `${w.n} ${c}`).toBe(true);
    }
  });

  it("les ailes se touchent sans se chevaucher de plus de 0,6 m : aile ouest / bloc nord, barre / noyau", () => {
    const by = (n: string) => main.wings!.find((w) => w.n === n)!.r;
    expect(Math.abs(by("aile-ouest")[3] - by("bloc-nord")[2])).toBeLessThan(0.6);
    expect(Math.abs(by("barre")[3] - by("noyau")[2])).toBeLessThan(0.6);
  });

  it("gymnase : hall à deux pentes entre deux bas-côtés plats ; faîtage à 5,3 m ± 0,5 du sol, égouts plus bas, pente entre 0,08 et 0,2", () => {
    const g = ground(GYM), st = gym.gym!.strips;
    expect(st).toHaveLength(3);
    expect(st[0]!.u[1]).toBe(st[1]!.u[0]);
    expect(st[1]!.u[1]).toBe(st[2]!.u[0]);
    const [ru, rz] = st[1]!.ridge!;
    expect(rz - g).toBeGreaterThan(4.8);
    expect(rz - g).toBeLessThan(5.8);
    expect(st[1]!.eave!).toBeLessThan(rz);
    expect(st[0]!.z!).toBeLessThan(rz);
    const slope = (rz - st[1]!.eave!) / (ru - st[1]!.u[0]);
    expect(slope).toBeGreaterThan(0.08);
    expect(slope).toBeLessThan(0.2);
    expect(gymRoofZ(st, ru)).toBeCloseTo(rz, 9);
    expect(gymRoofZ(st, st[1]!.u[0] + 1e-6)).toBeCloseTo(st[1]!.eave!, 5);
    expect(gymRoofZ(st, st[0]!.u[0] + 1)).toBe(st[0]!.z);
    expect(gymRoofZ(st, 99)).toBeNaN();
  });

  it("découpe en bande : l'aire des morceaux d'un carré est celle du carré", () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const area = (p: [number, number][]): number => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]!; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
    expect(area(clipStrip(sq, 2, 5))).toBeCloseTo(30, 9);
    expect(area(clipStrip(sq, -3, 4)) + area(clipStrip(sq, 4, 20))).toBeCloseTo(100, 9);
    expect(clipStrip(sq, 20, 30)).toHaveLength(0);
  });

  it("le petit bâtiment …849030 (photo 4) a son toit plat au niveau du LiDAR : 4,3 m du sol, et non les 7,1 m de la BD TOPO", () => {
    const b = tile.buildings.find((x) => x.id === "BATIMENT0000000348849030")!;
    expect(b.roofKind).toBe("flat");
    expect(b.eave - b.ground).toBeGreaterThan(4.0);
    expect(b.eave - b.ground).toBeLessThan(4.7);
  });

  it("le bloc ouest …849004 (8,8 m au LiDAR, deux niveaux hauts) reste un bâtiment BD TOPO ordinaire", () => {
    expect(kinds.buildings[WEST]!.vallon).toBeUndefined();
  });

  it("les bâtiments modélisés remplacent la façade et les murs génériques", () => {
    for (const id of [MAIN, PREAU, GYM]) expect(replacesFacade(kinds.buildings[id] as BuildingKind)).toBe(true);
    expect(replacesFacade(kinds.buildings[WEST] as BuildingKind)).toBe(false);
  });
});

describe("Collège du Vallon (D172) : maillage", () => {
  it("ailes : maillage fini, haut du maillage à l'acrotère de la barre, moins de 6 000 triangles", () => {
    const s = sinks();
    buildVallon(s, main, flatAt(ground(MAIN)));
    expect(triangles(s)).toBeGreaterThan(100);
    expect(triangles(s)).toBeLessThan(6000);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
    expect(topOf(s)).toBeCloseTo(main.wings!.find((w) => w.n === "barre")!.z + VALLON_PARAPET, 6);
  });

  it("préau : quatre voûtes dont le sommet est celui du modèle, moins de 1 500 triangles", () => {
    const s = sinks();
    buildVallon(s, preau, flatAt(ground(PREAU)));
    expect(triangles(s)).toBeGreaterThan(4 * 6 * 2);
    expect(triangles(s)).toBeLessThan(1500);
    expect(topOf(s)).toBeCloseTo(preau.preau!.crown, 3);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
  });

  it("gymnase : haut au faîtage, aucune face plus haute que lui, moins de 1 500 triangles", () => {
    const s = sinks();
    buildVallon(s, gym, flatAt(ground(GYM)));
    expect(triangles(s)).toBeGreaterThan(30);
    expect(triangles(s)).toBeLessThan(1500);
    expect(topOf(s)).toBeCloseTo(gym.gym!.strips[1]!.ridge![1], 3);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
  });

  it("budget : le collège entier reste sous 9 000 triangles", () => {
    const s = sinks();
    for (const m of [main, preau, gym]) buildVallon(s, m, flatAt(-35));
    expect(triangles(s)).toBeLessThan(9000);
  });
});
