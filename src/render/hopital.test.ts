import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D161 : le Centre hospitalier d'Autun, site Parpas, d'après deux photos de face (`fronts` de manual.json) : le bloc vitré (093) et l'aile crème voisine (094). */
describe("Centre hospitalier, site Parpas (D161)", () => {
  const tile = JSON.parse(readFileSync("public/data/tiles/24_35.json", "utf8")) as TileData;
  const fiche = (n: string): FacadeFiche => tile.fiches.find((q) => q.id === `BATIMENT00000003488540${n}`)!;
  const glass = fiche("93"), wing = fiche("94");

  it("deux fiches observées, devanture moderne sur un mur de rue qui contient les travées", () => {
    for (const [f, wall] of [[glass, 30], [wing, 9]] as const) {
      expect(f.status).toBe("observed");
      expect(f.ground.front).toBe(wall);
      const w = f.walls[wall]!;
      expect(w.role).toBe("street");
      const d = f.ground.devanture!;
      expect(d.modern).toBeDefined();
      const width = d.bays.reduce((a, q) => a + q[1], 0);
      expect(d.s0).toBe(0);
      // Le bloc vitré remplit son mur ; l'aile crème n'en habille que les 18 premiers mètres (au-delà, ce sont des maisons voisines).
      expect(width).toBeGreaterThan(f === glass ? w.length - 0.05 : 18);
      expect(width).toBeLessThanOrEqual(w.length + 0.01);
      expect(d.h).toBeLessThanOrEqual(f.storeys.ground + 0.01);
    }
  });

  it("le bloc vitré : emblème, enseigne bleue, portes automatiques, mur-rideau sous l'égout", () => {
    const d = glass.ground.devanture!, m = d.modern!;
    expect(m.words.parts[0]![0]).toBe("centre hospitalier");
    expect(m.sub!.text).toBe("site Parpas");
    expect(d.bays.some(([k]) => k === "shopdoor")).toBe(true);
    // L'emblème est sur le mur, au-dessus des portes, entre les bords du bloc.
    expect(m.emblem!.z - m.emblem!.h / 2).toBeGreaterThan(d.top);
    expect(m.emblem!.s - m.emblem!.w / 2).toBeGreaterThan(0);
    expect(m.words.at).toBeGreaterThan(m.emblem!.s + m.emblem!.w / 2);
    // Mur-rideau : de l'enseigne à l'égout, sur toute la largeur du mur, trois niveaux.
    const k = m.curtain!;
    const wall = glass.walls[glass.ground.front!]!;
    expect(k.s[0]).toBe(0);
    expect(k.s[1]).toBeCloseTo(wall.length, 2);
    expect(k.z[0]).toBeGreaterThanOrEqual(d.h - 0.01);
    expect(k.z[1]).toBeLessThan(wall.eave - wall.datum);
    expect(k.rows).toBe(3);
  });

  it("l'aile crème : passage couvert avec sens interdit, étages à volets roulants, trois niveaux", () => {
    const d = wing.ground.devanture!;
    const i = d.bays.findIndex(([k]) => k === "passage");
    expect(i).toBeGreaterThan(0);
    expect(wing.levels).toBe(3);
    expect(wing.facade.shutters.kind).toBe("roulant");
    // Le sens interdit est tout près du passage, à sa droite.
    let end = d.s0;
    for (let q = 0; q <= i; q++) end += d.bays[q]![1];
    const nope = d.modern!.logos!.find((l) => l[3] === "#c8202a")!;
    expect(nope[0]).toBeGreaterThan(end);
    expect(nope[0]).toBeLessThan(end + 1.5);
  });

  it("les murets et la grille d'OpenStreetMap devant l'entrée sont retirés", () => {
    for (const id of [-900009192, -900009235, -900009240]) expect(tile.walls.some((w) => w.id === id)).toBe(false);
  });

  it("géométrie : sommets finis, coût borné, vitres allumées la nuit, rien derrière le mur ni à plus de 0,5 m devant", () => {
    for (const f of [glass, wing]) {
      const d = f.ground.devanture!;
      const mb = new MeshBuilder(), glow = new MeshBuilder();
      buildDevanture(mb, glow, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, f.ground.shopfront!.color);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      expect(mb.positions.length / 9).toBeLessThan(2500);
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 2; i < mb.positions.length; i += 3) {
        zmin = Math.min(zmin, mb.positions[i]!);
        zmax = Math.max(zmax, mb.positions[i]!);
      }
      expect(zmin).toBeGreaterThan(-0.2);
      expect(zmax).toBeLessThan(0.6);
    }
    const glow = new MeshBuilder();
    buildDevanture(new MeshBuilder(), glow, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, glass.ground.devanture!, "#d9d6cf");
    expect(glow.positions.length / 9).toBeGreaterThan(20);
  });
});

/** D163 : Centre hospitalier d'Autun, site Latouche, d'après les photos prises sur le parking d'accueil (46,951935 ; 4,301921). */
describe("Centre hospitalier, site Latouche (D163)", () => {
  const tiles = ["26_35", "26_36", "27_35", "27_36"].map((id) => JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData);
  const fiches = tiles.flatMap((t) => t.fiches), buildings = tiles.flatMap((t) => t.buildings);
  const id = (n: string): string => `BATIMENT00000003${n}`;
  const reception = fiches.find((f) => f.id === id("48848381"))!;

  it("cinq bâtiments vus sur photo, dont le bâtiment d'accueil à devanture moderne sur son mur de 46 m", () => {
    for (const n of ["48848381", "48844713", "48844702", "48844714", "48848386"]) expect(fiches.find((f) => f.id === id(n))?.status, n).toBe("observed");
    expect(reception.ground.front).toBe(3);
    const wall = reception.walls[3]!;
    expect(wall.role).toBe("street");
    expect(wall.length).toBeGreaterThan(46);
    expect(wall.length).toBeLessThan(46.5);
    expect(reception.levels).toBe(2);
    expect(reception.facade.shutters.kind).toBe("roulant");
  });

  it("l'auvent : sur le mur, au-dessus des portes vitrées, poteaux sous la dalle ; le « bâtiment » de BD TOPO qui le figurait est retiré", () => {
    const d = reception.ground.devanture!, m = d.modern!, c = m.canopy!;
    const wall = reception.walls[3]!;
    let s = d.s0, doors = 0;
    for (const [kind, w] of d.bays) {
      if (kind === "shopdoor") {
        doors = s + w / 2;
        expect(s).toBeGreaterThan(c.s[0] - 0.01);
        expect(s + w).toBeLessThan(c.s[1] + 0.01);
      }
      s += w;
    }
    expect(doors).toBeGreaterThan(24);
    expect(doors).toBeLessThan(28);
    expect(c.s[1]).toBeLessThan(wall.length);
    expect(c.z).toBeGreaterThan(d.top);
    expect(c.z).toBeLessThan(d.h);
    expect(c.depth).toBeGreaterThan(2);
    expect(c.depth).toBeLessThan(3.5);
    for (const p of c.pillars) {
      expect(p).toBeGreaterThan(c.s[0]);
      expect(p).toBeLessThan(c.s[1]);
    }
    expect(buildings.some((b) => b.id === id("48848382"))).toBe(false);
    expect(fiches.some((f) => f.id === id("48848382"))).toBe(false);
    const mb = new MeshBuilder();
    buildDevanture(mb, null, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, "#e8e5dc");
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(2500);
  });

  it("le réveil de Latouche : devant l'entrée, à l'air libre (hors de tout bâtiment), côté parvis, et la croix de soin est à côté", async () => {
    const { HOSPITALS } = await import("../core/health");
    const { HEAL_SITES } = await import("../core/pickups");
    const spawn = HOSPITALS.find((h) => h.id === "latouche")!;
    const inside = (x: number, y: number, ring: number[]): boolean => {
      let c = false;
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[2 * i]!, yi = ring[2 * i + 1]!, xj = ring[2 * j]!, yj = ring[2 * j + 1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const heal = HEAL_SITES.find((h) => h.label === "Centre hospitalier, site Latouche")!;
    for (const [x, y] of [[spawn.x, spawn.y], [heal.x, heal.y]] as const) expect(buildings.some((b) => inside(x, y, b.ring)), `${x},${y}`).toBe(false);
    // Devant le mur de 46 m : du côté de sa normale sortante, entre 3 et 12 m, à hauteur de l'auvent.
    const b = buildings.find((q) => q.id === id("48848381"))!;
    const w = reception.walls[3]!;
    const p = [b.ring[2 * w.a]!, b.ring[2 * w.a + 1]!], q = [b.ring[2 * w.b]!, b.ring[2 * w.b + 1]!];
    const L = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
    const tx = (q[0]! - p[0]!) / L, ty = (q[1]! - p[1]!) / L, nx = ty, ny = -tx;
    const along = (spawn.x - p[0]!) * tx + (spawn.y - p[1]!) * ty, out = (spawn.x - p[0]!) * nx + (spawn.y - p[1]!) * ny;
    const c = reception.ground.devanture!.modern!.canopy!;
    expect(out).toBeGreaterThan(3);
    expect(out).toBeLessThan(12);
    expect(along).toBeGreaterThan(c.s[0]);
    expect(along).toBeLessThan(c.s[1]);
    expect(Math.hypot(heal.x - spawn.x, heal.y - spawn.y)).toBeLessThan(10);
  });
});
