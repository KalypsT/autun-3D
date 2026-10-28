import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Building, Site, TileKinds } from "../data/types";
import { Colliders } from "./collision";
import { fuelLayout, isOpen, landmarkCircles, PARAPET, reshapeBuilding } from "./landmarks";
import { loadRealWorld } from "./testing";
import { addTileColliders } from "./world";

/** Bâtiment rectangulaire 20 × 10 m, toit à deux pans de faîtage 4 m au-dessus de l'égout (10 m). */
function gable(): Building {
  return {
    id: "B", rnb: null, ground: 0, roofColor: null, eave: 10, ridge: 14, roofKind: "gable", q: { n: 0, planes: 2 },
    bd: { levels: null, height: null, walls: null, roof: null, year: null, use: null, use2: null, nature: null },
    ring: [0, 0, 20, 0, 20, 10, 0, 10], top: [10, 10, 10, 10], holes: [], holeTop: [], steps: [[0, 0, 0, 1, 1, 1, 0, 1]], chim: [[5, 5, 1, 1, 13, 15]],
    // Pans : z = 10 + 0,8·y au sud, z = 18 − 0,8·y au nord.
    faces: [{ p: [0, 0.8, 10], r: [0, 0, 20, 0, 20, 5, 0, 5, 0, 0], h: [] }, { p: [0, -0.8, 18], r: [0, 5, 20, 5, 20, 10, 0, 10, 0, 5], h: [] }],
  };
}

const planeZ = (b: Building, face: number, x: number, y: number): number => {
  const [a, bb, c] = b.faces[face]!.p;
  return a * x + bb * y + c;
};

describe("gabarits : forme des bâtiments", () => {
  it("toit plat et acrotère pour une grande surface", () => {
    const b = reshapeBuilding(gable(), "retail");
    for (const f of b.faces) expect(Math.abs(f.p[0]) + Math.abs(f.p[1])).toBe(0);
    expect(planeZ(b, 0, 10, 5)).toBeCloseTo(10);
    expect(b.top.every((z) => Math.abs(z - (10 + PARAPET)) < 1e-9)).toBe(true);
    expect(b.roofKind).toBe("flat");
    expect(b.chim).toEqual([]);
    expect(b.steps).toEqual([]);
  });

  it("pente écrasée pour un hangar : les pans restent jointifs au faîtage", () => {
    const b = reshapeBuilding(gable(), "industrial");
    const ridgeS = planeZ(b, 0, 10, 5), ridgeN = planeZ(b, 1, 10, 5);
    expect(ridgeS).toBeCloseTo(ridgeN);
    expect(ridgeS - 10).toBeCloseTo(4 * 0.28);
    expect(planeZ(b, 0, 10, 0)).toBeCloseTo(10);
    expect(b.ridge).toBeCloseTo(10 + 4 * 0.28);
  });

  it("logements et services publics gardent leur toit", () => {
    const original = gable();
    expect(reshapeBuilding(original, undefined)).toBe(original);
    expect(reshapeBuilding(original, "townhall")).toBe(original);
    expect(reshapeBuilding(original, "church")).toBe(original);
  });
});

describe("gabarits : station-service", () => {
  const site: Extract<Site, { t: "fuel" }> = { t: "fuel", x: 100, y: 50, a: 0.5, l: 18, w: 8 };

  it("poteaux sous l'auvent, îlots entre les poteaux, totem dehors", () => {
    const lay = fuelLayout(site);
    const local = ([x, y]: [number, number]): [number, number] => {
      const dx = x - site.x, dy = y - site.y;
      return [dx * Math.cos(site.a) + dy * Math.sin(site.a), -dx * Math.sin(site.a) + dy * Math.cos(site.a)];
    };
    expect(lay.posts.length).toBeGreaterThanOrEqual(2);
    expect(lay.islands.length).toBe(lay.posts.length - 1);
    for (const p of [...lay.posts, ...lay.islands]) {
      const [s, t] = local(p);
      expect(Math.abs(s)).toBeLessThan(site.l / 2);
      expect(Math.abs(t)).toBeLessThan(site.w / 2);
    }
    expect(Math.abs(local(lay.totem)[0])).toBeGreaterThan(site.l / 2);
  });

  it("on passe sous un auvent, pas à travers ses poteaux", () => {
    const roof = { ...gable(), id: "R", ring: [0, 0, 18, 0, 18, 8, 0, 8] };
    const kinds: TileKinds = { v: 1, buildings: { R: { k: "canopy" } }, sites: [{ ...site, x: 9, y: 4, a: 0, roof: "R" }] };
    expect(isOpen(kinds, "R")).toBe(true);
    const c = new Colliders();
    addTileColliders(c, { buildings: [roof], walls: [], furniture: [], trees: [], kinds });
    const circles = landmarkCircles(kinds, [roof]);
    expect(circles.length).toBeGreaterThan(3);
    // Sous l'auvent, entre poteaux et îlots, rien ne bloque ; contre un poteau, si.
    expect(c.resolve(9, 7, 0.35).hit).toBe(false);
    const [px, py] = circles[0]!;
    expect(c.resolve(px + 0.2, py, 0.35).hit).toBe(true);
  });
});

describe("gabarits : données réelles (public/data/kinds)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const ids = new Set(world.tile.buildings.map((b) => b.id));
  const index = JSON.parse(readFileSync("public/data/kinds/index.json", "utf8")) as { tiles: string[] };

  it("chaque type désigne un bâtiment qui existe, et l'index liste les fichiers", () => {
    const missing = Object.keys(kinds.buildings).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    expect(index.tiles.length).toBeGreaterThan(50);
  });

  it("les lieux connus sont reconnus", () => {
    const byName = (n: string): string[] => Object.values(kinds.buildings).filter((k) => k.n === n).map((k) => k.k);
    expect(byName("HÔTEL DE VILLE")).toEqual(["townhall"]);
    expect(byName("GARE D'AUTUN")).toEqual(["station"]);
    expect(byName("E.Leclerc")).toEqual(["retail"]);
    expect(byName("La Poste")).toContain("post");
    // La flèche de la cathédrale Saint-Lazare : plus de 70 m au-dessus de la tour la plus basse.
    const spires = Object.values(kinds.buildings).filter((k) => k.tower).map((k) => k.tower![4] - k.tower![3]);
    expect(Math.max(...spires)).toBeGreaterThan(40);
  });

  it("terrains de sport et stations-service ont une géométrie utilisable", () => {
    for (const s of kinds.sites) {
      if (s.t === "pitch") {
        expect(s.r.length).toBeGreaterThanOrEqual(6);
        expect(s.box[3]).toBeGreaterThanOrEqual(s.box[4]);
      } else if (s.t === "fuel") {
        expect(s.l).toBeGreaterThan(4);
      }
    }
    expect(kinds.sites.filter((s) => s.t === "fuel").length).toBeGreaterThanOrEqual(2);
  });
});
