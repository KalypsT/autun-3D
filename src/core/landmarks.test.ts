import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Building, JanusSite, RoundaboutSite, Site, TileKinds } from "../data/types";
import { Colliders } from "./collision";
import { arcadePosts, at, carportShape, fuelLayout, furnitureOutsideMonuments, gateLayout, houseEdges, edgeFrame, houseFrame, houseRing, housePost, inJanus, inRoundabout, isOpen, janusSlabs, landmarkCircles, landmarkRings, PARAPET, playCircles, reshapeBuilding, storeCircles, treesOutsideMonuments, wallsOutsideMonuments } from "./landmarks";
import { CACHES } from "./pickups";
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
    // L'hôtel de ville n'a plus d'inscription (il n'en a pas sur la photo, D123) : il est reconnu par son modèle dédié.
    expect(byName("HÔTEL DE VILLE")).toEqual([]);
    expect(Object.values(kinds.buildings).filter((k) => k.hall).map((k) => k.k)).toEqual(["townhall"]);
    expect(byName("GARE D'AUTUN")).toEqual(["station"]);
    expect(byName("E.Leclerc")).toEqual(["retail"]);
    expect(byName("La Poste")).toContain("post");
    // La flèche de la cathédrale Saint-Lazare : plus de 30 m au-dessus du corps de la tour de croisée.
    const spires = Object.values(kinds.buildings).filter((k) => k.tower).map((k) => k.tower![4] - k.tower![3]);
    expect(Math.max(...spires)).toBeGreaterThan(30);
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

describe("monuments (D95)", () => {
  const gate: Extract<Site, { t: "gate" }> = { t: "gate", st: "arroux", n: "Porte d'Arroux", x: 0, y: 0, a: 0.3, l: 18.7, w: 4.3, top: 14 };

  it("porte romaine : deux grandes arches au centre, deux petites aux bouts, dix arcades de galerie", () => {
    const lay = gateLayout(gate, 0);
    expect(lay.height).toBeCloseTo(14);
    const ground = lay.openings.filter((o) => o.zb < 0);
    const gallery = lay.openings.filter((o) => o.zb > 0);
    expect(ground.length).toBe(4);
    expect(gallery.length).toBe(10);
    const widths = ground.map((o) => o.s1 - o.s0).sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(2.2);
    expect(widths[3]).toBeCloseTo(4.3);
    // Les ouvertures restent dans la porte, ne se chevauchent pas, et les arcades sont au-dessus des grandes arches.
    const sorted = [...ground].sort((a, b) => a.s0 - b.s0);
    for (let i = 0; i + 1 < sorted.length; i++) expect(sorted[i]!.s1).toBeLessThan(sorted[i + 1]!.s0);
    expect(sorted[0]!.s0).toBeGreaterThan(-gate.l / 2);
    for (const o of ground) expect(o.spring + (o.s1 - o.s0) / 2).toBeLessThan(lay.m.attic);
    // Piles + ouvertures couvrent toute la longueur.
    const piers = lay.piers.reduce((sum, [a, b]) => sum + b - a, 0);
    expect(piers + widths.reduce((a, b) => a + b, 0)).toBeCloseTo(gate.l);
  });

  it("on passe sous les grandes arches, pas à travers les piles", () => {
    const c = new Colliders();
    for (const r of landmarkRings({ sites: [gate] }, () => 0)) c.addRing(r);
    const f = gateLayout(gate, 0).frame;
    for (const s of [-2.7, 2.7]) {
      for (const t of [-3, 0, 3]) {
        const [x, y] = at(f, s, t);
        expect(c.resolve(x, y, 0.35).hit).toBe(false);
      }
    }
    const [px, py] = at(f, 0.75, 0);
    expect(c.resolve(px, py, 0.35).hit).toBe(true);
  });

  describe("données réelles", () => {
    const world = loadRealWorld();
    const kinds = world.tile.kinds!;
    const index = JSON.parse(readFileSync("public/data/kinds/index.json", "utf8")) as { landmarks: { id: string; t: number[] }[] };

    it("cathédrale Saint-Lazare : volumes mesurés plausibles, repère lointain dans l'index", () => {
      const mon = Object.entries(kinds.buildings).filter(([, k]) => k.mon);
      expect(mon.length).toBe(1);
      const [id, k] = mon[0]!;
      const m = k.mon!;
      // Environ 80 m de long, flèche à plus de 75 m au-dessus du parvis.
      expect(m.east - m.west).toBeGreaterThan(70);
      expect(m.east - m.west).toBeLessThan(95);
      expect(m.tip - m.g).toBeGreaterThan(75);
      expect(m.body).toBeLessThan(m.tip);
      expect(m.cross).toBeGreaterThan(m.west);
      expect(m.cross).toBeLessThan(m.east);
      expect(index.landmarks.some((l) => l.id === id)).toBe(true);
    });

    it("les deux portes romaines sont là, et le bâtiment sous la porte Saint-André est masqué", () => {
      const gates = kinds.sites.filter((s) => s.t === "gate");
      expect(gates.map((g) => g.st).sort()).toEqual(["andre", "arroux"]);
      for (const g of gates) {
        const h = gateLayout(g, world.terrain.heightAt(g.x, g.y)).height;
        expect(h).toBeGreaterThan(8);
        expect(h).toBeLessThan(18);
      }
      expect(Object.values(kinds.buildings).filter((k) => k.k === "hidden").length).toBeGreaterThanOrEqual(1);
    });

    it("temple de Janus (D139) : cella mesurée, deux murs debout de 20 m, on passe par les arches, ni faux arbres ni mur OpenStreetMap", () => {
      const t = kinds.sites.find((q): q is JanusSite => q.t === "janus")!;
      expect(t).toBeDefined();
      // 16,6 m de côté dans les sources.
      for (const L of t.L) {
        expect(L).toBeGreaterThan(15.5);
        expect(L).toBeLessThan(17.5);
      }
      for (const w of t.tw) {
        expect(w).toBeGreaterThan(1.6);
        expect(w).toBeLessThan(3);
      }
      for (const w of [t.S, t.W]) {
        const hi = Math.max(...w.top.map((p) => p[1]));
        expect(hi).toBeGreaterThan(18);
        expect(hi).toBeLessThan(24);
      }
      expect(t.pod).toBeGreaterThan(0.3);
      expect(t.pod).toBeLessThan(1.5);
      const c = new Colliders();
      for (const r of landmarkRings({ sites: [t] }, () => 0)) c.addRing(r);
      for (const sl of janusSlabs(t)) {
        const tm = (sl.tA + sl.tB) / 2;
        for (const [ac] of sl.wall.arches) {
          const [x, y] = at(sl.f, ac, tm);
          expect(c.resolve(x, y, 0.35).hit).toBe(false);
        }
        // Contre la face, entre le coin et la première arche : bloqué.
        const solid = (sl.d0 + Math.min(...sl.wall.arches.map((q) => q[0] - q[1] / 2))) / 2;
        const [x, y] = at(sl.f, solid, sl.tB + 0.2);
        expect(c.resolve(x, y, 0.35).hit).toBe(true);
      }
      expect(treesOutsideMonuments({ sites: [t] }, [[t.o[0] + 5, t.o[1] + 1, 0, 20, 1.2, 4.5], [t.o[0] - 30, t.o[1], 0, 8, 3, 3]] as never).length).toBe(1);
      expect(wallsOutsideMonuments({ sites: [t] }, [{ id: t.wall, kind: "wall", height: 3.5, pts: [] }, { id: 1, kind: "wall", height: 1, pts: [] }] as never).map((w) => w.id)).toEqual([1]);
    });

    it("passants (D139) : une boucle traverse le temple par ses arches, sans traverser un mur", () => {
      const t = kinds.sites.find((q): q is JanusSite => q.t === "janus")!;
      const c = new Colliders();
      for (const r of landmarkRings({ sites: [t] }, () => 0)) c.addRing(r);
      const { n, e, g } = (JSON.parse(readFileSync("public/data/nav/s5_10.json", "utf8")) as { ped: { n: number[]; e: number[]; g: number[] } }).ped;
      let inside = 0;
      for (let i = 0; i < e.length; i += 11) {
        const [a, b, , , , , , , , p0, np] = e.slice(i, i + 11) as number[];
        const pts: [number, number][] = [[n[3 * a!]!, n[3 * a! + 1]!]];
        for (let k = 0; k < np!; k++) pts.push([g[2 * (p0! + k)]!, g[2 * (p0! + k) + 1]!]);
        pts.push([n[3 * b!]!, n[3 * b! + 1]!]);
        for (let j = 0; j + 1 < pts.length; j++) {
          const [ax, ay] = pts[j]!, [bx, by] = pts[j + 1]!;
          const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
          for (let q = 0; q <= steps; q++) {
            const x = ax + ((bx - ax) * q) / steps, y = ay + ((by - ay) * q) / steps;
            if (inJanus(t, x, y)) inside++;
            expect(c.resolve(x, y, 0.2).hit).toBe(false);
          }
        }
      }
      expect(inside).toBeGreaterThan(20);
    });

    it("porte Saint-André d'après photo (D138) : bouts mesurés, galerie complète sur les deux faces, toit, tour plus haute que le toit", () => {
      const s = kinds.sites.find((q): q is Extract<Site, { t: "gate" }> => q.t === "gate" && q.st === "andre")!;
      const m = s.gm!;
      // De la tour (bout libre au LiDAR) à l'église (emprise BD TOPO) : environ 21 m, 19,1 m dans les sources sans la tour.
      expect(m.l).toBeGreaterThan(19);
      expect(m.l).toBeLessThan(23);
      const lay = gateLayout(s, world.terrain.heightAt(s.x, s.y));
      expect(lay.openings.filter((o) => o.zb > 0).length).toBe(10);
      expect(lay.gallery!.walls.length).toBe(2);
      const [eave, ridge] = m.roof!;
      expect(ridge).toBeGreaterThan(eave);
      expect(ridge).toBeGreaterThan(12.5);
      expect(ridge).toBeLessThan(15);
      const [t0, t1, , , top] = m.tower!;
      expect(top).toBeGreaterThan(ridge + 0.4);
      expect(t1 - t0).toBeGreaterThan(1.5);
      expect(t1 - t0).toBeLessThan(4);
      // La tour est au bout sud-sud-est (y le plus petit des deux bouts).
      const [, ty] = at(lay.frame, (t0 + t1) / 2, 0), [, oy] = at(lay.frame, -(t0 + t1) / 2, 0);
      expect(ty).toBeLessThan(oy);
      // Aucune arche ne tombe sous la tour.
      for (const o of lay.openings) expect(o.s1 <= t0 || o.s0 >= t1).toBe(true);
    });

    it("maison du 7 allée de l'Acaron (D140) : plan en L, égout et pente mesurés, toit couvrant, obstacle aux murs mesurés, entrée couverte", () => {
      const id = "BATIMENT0000000348848724";
      const m = kinds.buildings[id]!.house!;
      const [[s0, s1, t0, t1], [sw, , , tw]] = m.walls;
      // Corps d'environ 13 × 7,5 m, aile de 7 à 8 m qui avance de 3 m (relevé LiDAR ; le contour BD TOPO, 12,4 × 6,7 m, est décalé).
      expect(s1 - s0).toBeGreaterThan(12);
      expect(s1 - s0).toBeLessThan(14.5);
      expect(t1 - t0).toBeGreaterThan(6.5);
      expect(t1 - t0).toBeLessThan(8.5);
      expect(s1 - sw).toBeGreaterThan(6);
      expect(s1 - sw).toBeLessThan(9);
      expect(tw - t1).toBeGreaterThan(2.5);
      expect(tw - t1).toBeLessThan(4);
      // Plain-pied avec combles : égout vers 3 m, pente vers 45°, faîtage vers 6,5 m.
      expect(m.eave).toBeGreaterThan(2.4);
      expect(m.eave).toBeLessThan(3.4);
      const deg = (Math.atan(m.pitch) * 180) / Math.PI;
      expect(deg).toBeGreaterThan(38);
      expect(deg).toBeLessThan(52);
      const ridge = m.eave + (m.pitch * (t1 - t0)) / 2;
      expect(ridge).toBeGreaterThan(5.8);
      expect(ridge).toBeLessThan(7.5);
      // Les pans couvrent le L et son débord, sans se chevaucher.
      const area = (r: number[]): number => {
        let a = 0;
        for (let i = 0; i < r.length; i += 2) a += r[i]! * r[(i + 3) % r.length]! - r[(i + 2) % r.length]! * r[i + 1]!;
        return Math.abs(a) / 2;
      };
      const o = m.ov, cover = (s1 - s0 + 2 * o) * (t1 - t0 + 2 * o) + (s1 - sw + 2 * o) * (tw - t1);
      expect(m.roof.reduce((a, f) => a + area(f.r), 0)).toBeCloseTo(cover, 0);
      // Chaque pan reste au-dessus de l'égout du débord et sous le faîtage.
      for (const f of m.roof) {
        for (let i = 0; i < f.r.length; i += 2) {
          const z = f.k[0] * f.r[i]! + f.k[1] * f.r[i + 1]! + f.k[2];
          expect(z).toBeGreaterThan(m.eave - o * m.pitch - 0.05);
          expect(z).toBeLessThan(ridge + 0.6);
        }
      }
      // Obstacle : les murs mesurés et le poteau ; on entre sous l'auvent jusqu'à la porte.
      const f = houseFrame(m);
      const c = new Colliders();
      c.addRing(houseRing(m));
      const [px, py] = housePost(m);
      c.addCircle(px, py, 0.12);
      // Contre le mur mesuré du corps, là où le contour BD TOPO (décalé d'environ 0,6 m) laissait passer.
      expect(c.resolve(...at(f, (s0 + s1) / 2, t0 + 0.1), 0.35).hit).toBe(true);
      expect(c.resolve(...at(f, sw + m.porch[0] / 2, tw - m.porch[1] + 0.5), 0.35).hit).toBe(false);
      expect(c.resolve(px, py, 0.35).hit).toBe(true);
      expect(landmarkCircles(kinds, world.tile.buildings).some(([x, y]) => Math.hypot(x - px, y - py) < 1e-6)).toBe(true);
      // Ouvertures : sur un mur existant, dans sa longueur.
      const edges = houseEdges(m);
      for (const op of m.openings) {
        const e = edges[op[0]]!;
        expect(op[1]).toBeGreaterThan(0);
        expect(op[1] + (op[2] === "lamp" ? 0 : op[3] / 2)).toBeLessThan(e.len);
      }
      // Rien de la carte (arbres, mobilier) ne tombe dans la maison ni contre ses murs.
      const ring = houseRing(m);
      const inside = (x: number, y: number): boolean => {
        let r = false;
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          if (ring[i + 1]! > y !== ring[j + 1]! > y && x < ring[i]! + ((y - ring[i + 1]!) * (ring[j]! - ring[i]!)) / (ring[j + 1]! - ring[i + 1]!)) r = !r;
        }
        return r || c.resolve(x, y, 0.5).hit;
      };
      for (const [x, y] of world.tile.trees) expect(inside(x, y)).toBe(false);
      for (const fu of world.tile.furniture) expect(inside(fu.x, fu.y)).toBe(false);
    });

    it("rond-point de la Croix Verte (D142) : îlot et cèdre mesurés, faux arbres et lampadaire retirés, tronc seul obstacle, voitures et passants à l'écart", () => {
      const s = kinds.sites.find((q): q is RoundaboutSite => q.t === "roundabout")!;
      expect(s).toBeDefined();
      // Bordure ajustée sur l'orthophoto : environ 13,7 m de rayon, à quelques centimètres près sur une centaine de rayons.
      expect(s.r).toBeGreaterThan(12.5);
      expect(s.r).toBeLessThan(15);
      expect(s.fit![0]).toBeGreaterThan(50);
      expect(s.fit![1]).toBeLessThan(0.2);
      expect(s.mound).toBeGreaterThan(0);
      expect(s.mound).toBeLessThan(1);
      // Cèdre : environ 13,7 m, couronne large en bas et plus étroite en haut, tronc dans l'îlot.
      expect(s.tree.top).toBeGreaterThan(11);
      expect(s.tree.top).toBeLessThan(16);
      const t = s.tree.tiers;
      expect(t[0]![1]).toBeGreaterThan(t[t.length - 1]![1]);
      expect(t[0]![1]).toBeLessThan(s.r);
      expect(inRoundabout(s, s.tree.x, s.tree.y)).toBe(true);
      expect(Math.hypot(s.tree.x - s.c[0], s.tree.y - s.c[1])).toBeLessThan(3);
      // Les trois « arbres » de 13 m du relevé dans la couronne et le lampadaire posé au bord de l'îlot sont retirés.
      const near = world.tile.trees.filter(([x, y]) => inRoundabout(s, x, y, 0.5));
      expect(near.length).toBe(3);
      expect(treesOutsideMonuments(kinds, near)).toHaveLength(0);
      const lamps = world.tile.furniture.filter((f) => inRoundabout(s, f.x, f.y, 0.5));
      expect(lamps.map((f) => f.id)).toEqual(s.drop);
      expect(furnitureOutsideMonuments(kinds, lamps)).toHaveLength(0);
      // Obstacles : le tronc ; l'îlot (bordure basse) se traverse.
      const c = new Colliders();
      for (const [x, y, r] of landmarkCircles(kinds, world.tile.buildings)) if (Math.hypot(x - s.c[0], y - s.c[1]) < 20) c.addCircle(x, y, r);
      expect(c.resolve(s.tree.x + 0.5, s.tree.y, 0.35).hit).toBe(true);
      expect(c.resolve(s.c[0] + s.r, s.c[1], 0.35).hit).toBe(false);
      // Voitures : les files du graphe routier passent à plus de 2 m de la bordure ; passants : aucune file ne traverse l'îlot.
      const nav = JSON.parse(readFileSync("public/data/nav/s7_9.json", "utf8")) as { road: { n: number[]; e: number[]; g: number[] }; ped: { n: number[]; e: number[]; g: number[] } };
      const dist = (gr: { n: number[]; e: number[]; g: number[] }): number => {
        let best = Infinity;
        for (let i = 0; i < gr.e.length; i += 11) {
          const [a, b, , , , , , , , p0, np] = gr.e.slice(i, i + 11) as number[];
          const pts: [number, number][] = [[gr.n[3 * a!]!, gr.n[3 * a! + 1]!]];
          for (let k = 0; k < np!; k++) pts.push([gr.g[2 * (p0! + k)]!, gr.g[2 * (p0! + k) + 1]!]);
          pts.push([gr.n[3 * b!]!, gr.n[3 * b! + 1]!]);
          for (let j = 0; j + 1 < pts.length; j++) {
            const [ax, ay] = pts[j]!, [bx, by] = pts[j + 1]!;
            const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
            const u = Math.max(0, Math.min(1, ((s.c[0] - ax) * (bx - ax) + (s.c[1] - ay) * (by - ay)) / L2));
            best = Math.min(best, Math.hypot(ax + u * (bx - ax) - s.c[0], ay + u * (by - ay) - s.c[1]));
          }
        }
        return best;
      };
      expect(dist(nav.road)).toBeGreaterThan(s.r + s.curb / 2 + 2);
      expect(dist(nav.ped)).toBeGreaterThan(s.r + s.curb / 2);
      // Aucune cache d'arme dans l'îlot.
      for (const q of CACHES) expect(inRoundabout(s, q.x, q.y, 2)).toBe(false);
    });

    it("église Saint-André (D138) : nef et tour ronde mesurées, plus basses que la porte, tour ronde plus basse que la nef", () => {
      const k = Object.values(kinds.buildings).find((b) => b.chap)!;
      const c = k.chap!;
      const [s0, s1, t0, t1] = c.nave;
      expect(s1 - s0).toBeGreaterThan(8);
      expect(t1 - t0).toBeGreaterThan(10);
      expect(c.ridge).toBeGreaterThan(c.eave);
      expect(c.ridge).toBeLessThan(14);
      const [, , r, reave, apex] = c.round;
      expect(r).toBeGreaterThan(3.5);
      expect(r).toBeLessThan(7);
      expect(apex).toBeGreaterThan(reave);
      expect(apex).toBeLessThan(c.ridge);
    });

    it("passants (D138) : aucun chemin ne traverse une pile ou la tour d'une porte", () => {
      const c = new Colliders();
      const gates = kinds.sites.filter((q): q is Extract<Site, { t: "gate" }> => q.t === "gate");
      for (const r of landmarkRings({ sites: gates }, () => 0)) c.addRing(r);
      for (const cell of ["s6_9", "s7_9"]) {
        const { n, e, g } = (JSON.parse(readFileSync(`public/data/nav/${cell}.json`, "utf8")) as { ped: { n: number[]; e: number[]; g: number[] } }).ped;
        for (let i = 0; i < e.length; i += 11) {
          const [a, b, , , , , , , , p0, np] = e.slice(i, i + 11) as number[];
          const pts: [number, number][] = [[n[3 * a!]!, n[3 * a! + 1]!]];
          for (let k = 0; k < np!; k++) pts.push([g[2 * (p0! + k)]!, g[2 * (p0! + k) + 1]!]);
          pts.push([n[3 * b!]!, n[3 * b! + 1]!]);
          for (let j = 0; j + 1 < pts.length; j++) {
            const [ax, ay] = pts[j]!, [bx, by] = pts[j + 1]!;
            const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
            for (let q = 0; q <= steps; q++) {
              const x = ax + ((bx - ax) * q) / steps, y = ay + ((by - ay) * q) / steps;
              if (gates.every((s) => Math.hypot(x - s.gm!.c[0], y - s.gm!.c[1]) > 15)) continue;
              expect(c.resolve(x, y, 0.2).hit).toBe(false);
            }
          }
        }
      }
    });

    it("porte d'Arroux d'après photo (D137) : corps mesuré, galerie conservée sur 7 arcades côté ville, passages pour les voitures et les piétons", () => {
      const s = kinds.sites.find((q): q is Extract<Site, { t: "gate" }> => q.t === "gate" && q.st === "arroux")!;
      const m = s.gm!;
      expect(m).toBeDefined();
      expect(m.w).toBeGreaterThan(3.5);
      expect(m.w).toBeLessThan(5);
      // L'attique lu sur la photo (échelle : la longueur) et le haut du corps au relevé concordent à 1 m près.
      expect(Math.abs(m.attic - m.body)).toBeLessThan(1);
      const lay = gateLayout(s, world.terrain.heightAt(s.x, s.y));
      expect(lay.height).toBeGreaterThan(12);
      expect(lay.height).toBeLessThan(15);
      const arcades = lay.openings.filter((o) => o.zb > 0);
      expect(arcades.length).toBe(7);
      // Galerie : la partie gauche de la photo prise côté ville, sur la face côté ville.
      const [[gt0, gt1]] = lay.gallery!.walls as [[number, number]];
      const f = lay.frame, [gx, gy] = at(f, (lay.gallery!.s0 + lay.gallery!.s1) / 2, (gt0 + gt1) / 2);
      expect(lay.gallery!.s0 + lay.gallery!.s1).toBeGreaterThan(0);
      expect(gy - m.c[1]).toBeLessThan(0);
      expect(Math.hypot(gx - m.c[0], gy - m.c[1])).toBeLessThan(10);
      const passages = lay.openings.filter((o) => o.zb < 0).map((o) => o.s1 - o.s0).sort((a, b) => a - b);
      expect(passages[0]).toBeGreaterThan(1.5);
      expect(passages[3]).toBeGreaterThan(3.4);
      // Une voiture passe au milieu de chaque grande arche, un piéton dans chaque petite, sans toucher les piles.
      const c = new Colliders();
      for (const r of landmarkRings({ sites: [s] }, () => 0)) c.addRing(r);
      for (const o of lay.openings.filter((q) => q.zb < 0)) {
        for (const t of [-f.hw - 1, 0, f.hw + 1]) {
          const [x, y] = at(f, (o.s0 + o.s1) / 2, t);
          expect(c.resolve(x, y, o.s1 - o.s0 > 3 ? 1.0 : 0.35).hit).toBe(false);
        }
      }
    });
  });
});

describe("magasins d'après photo : Lidl, pharmacie et abri à chariots (D143)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const LIDL = "BATIMENT0000000348858792", PHARMACY = "BATIMENT0000002202684554", CART = "BATIMENT0000002101118190";
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const roofAt = (r: [number, number, number, number], x: number, y: number): number => r[0] * x + r[1] * y + r[2];
  const compass = (f: { nx: number; ny: number }): number => ((Math.atan2(f.nx, f.ny) * 180) / Math.PI + 360) % 360;
  const cell = JSON.parse(readFileSync("public/data/nav/s7_10.json", "utf8")) as { poi: number[] };
  const commerce = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < cell.poi.length; i += 5) if (cell.poi[i] === 2) out.push([cell.poi[i + 1]!, cell.poi[i + 2]!]);
    return out;
  };
  const distToEdge = (b: { ring: number[] }, e: number, x: number, y: number): number => {
    const f = edgeFrame(b.ring, e);
    const s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
    return Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o);
  };

  it("toit plan : murs et pans suivent le plan mesuré, l'égout est son point le plus bas", () => {
    const b = bOf(LIDL), roof = kinds.buildings[LIDL]!.roof!;
    const r = reshapeBuilding(b, "retail", roof);
    for (let i = 0; i < b.ring.length; i += 2) expect(r.top[i / 2]).toBeCloseTo(roofAt(roof, b.ring[i]!, b.ring[i + 1]!) + roof[3], 6);
    for (const f of r.faces) expect(f.p).toEqual([roof[0], roof[1], roof[2]]);
    expect(r.eave).toBeCloseTo(Math.min(...r.top) - roof[3], 6);
    expect(r.roofKind).toBe("flat");
    // Sans plan, le toit reste plat comme avant.
    expect(reshapeBuilding(b, "retail").top.every((z) => Math.abs(z - (b.eave + PARAPET)) < 1e-9)).toBe(true);
  });

  it("Lidl : toit incliné vers le nord-ouest mesuré, façade vitrée sur le mur ouest, sas entre deux panneaux, zone hachurée sur le mur sud-est", () => {
    const k = kinds.buildings[LIDL]!, b = bOf(LIDL), st = k.store!, roof = k.roof!;
    expect(k.k).toBe("retail");
    expect(st.style).toBe("lidl");
    // Toit à 5 – 8 m au-dessus du sol, plus haut au sud-est (pente de 3 à 10 %), acrotère de 15 à 70 cm.
    const hs = Array.from({ length: b.ring.length / 2 }, (_, i) => roofAt(roof, b.ring[2 * i]!, b.ring[2 * i + 1]!) - b.ground);
    expect(Math.min(...hs)).toBeGreaterThan(4.8);
    expect(Math.max(...hs)).toBeLessThan(8.2);
    const slope = Math.hypot(roof[0], roof[1]);
    expect(slope).toBeGreaterThan(0.03);
    expect(slope).toBeLessThan(0.1);
    expect(roof[1]).toBeLessThan(0);
    expect(roof[3]).toBeGreaterThanOrEqual(0.15);
    expect(roof[3]).toBeLessThanOrEqual(0.7);
    // Mur vitré : l'arête 0, de 33 m, regarde l'ouest-sud-ouest ; le vitrage tient dans le mur.
    const f = edgeFrame(b.ring, st.e);
    expect(f.len).toBeGreaterThan(31);
    expect(f.len).toBeLessThan(35);
    expect(compass(f)).toBeGreaterThan(225);
    expect(compass(f)).toBeLessThan(260);
    expect(st.glass[0]).toBeGreaterThanOrEqual(0);
    expect(st.glass[1]).toBeLessThanOrEqual(f.len);
    // Sas près du coin sud (fin de l'arête), de 4 à 5 m ; un panneau de chaque côté.
    const [c, w] = st.door!;
    expect(c + w / 2).toBeLessThan(st.glass[1]);
    expect(f.len - c).toBeGreaterThan(5);
    expect(f.len - c).toBeLessThan(12);
    expect(w).toBeGreaterThan(3.5);
    expect(w).toBeLessThan(6);
    expect(st.blades!.length).toBe(2);
    expect(st.blades![0]!).toBeLessThan(c - w / 2);
    expect(st.blades![1]!).toBeGreaterThan(c + w / 2);
    // Long mur plein : l'arête 1 (70 m), casier et grilles dedans, zone hachurée entre 1 et 4 m du mur.
    const g = edgeFrame(b.ring, st.side!.e);
    expect(g.len).toBeGreaterThan(65);
    expect(compass(g)).toBeGreaterThan(130);
    expect(compass(g)).toBeLessThan(175);
    expect(st.side!.locker[0] + st.side!.locker[1] / 2).toBeLessThan(g.len);
    for (const s of st.side!.vents) expect(s + 1).toBeLessThan(g.len);
    const [h0, h1, d0, d1] = st.side!.hatch;
    expect(h0).toBeLessThan(h1);
    expect(h1).toBeLessThan(g.len);
    expect(d0).toBeGreaterThan(0.5);
    expect(d1).toBeLessThan(5);
  });

  it("pharmacie : grande surface à toit plat, façade au nord-ouest, galerie de 2 m, croix sur la façade et sur le toit", () => {
    const k = kinds.buildings[PHARMACY]!, b = bOf(PHARMACY), st = k.store!, roof = k.roof!;
    expect(k.k).toBe("retail");
    expect(k.n).toBe("Pharmacie de Saint-Pan");
    expect(st.style).toBe("pharmacy");
    // Toit plat (pente de moins de 2 %) à 3 – 4 m du sol à la façade.
    expect(Math.hypot(roof[0], roof[1])).toBeLessThan(0.02);
    const f = edgeFrame(b.ring, st.e);
    const zf = roofAt(roof, f.x, f.y) - b.ground;
    expect(zf).toBeGreaterThan(2.9);
    expect(zf).toBeLessThan(4.2);
    expect(f.len).toBeGreaterThan(27);
    expect(compass(f)).toBeGreaterThan(315);
    expect(st.gallery!).toBeGreaterThan(1.5);
    expect(st.gallery!).toBeLessThan(3);
    expect(st.glass[0]).toBeGreaterThan(0);
    expect(st.glass[1]).toBeLessThan(f.len);
    expect(st.cross![0]).toBeLessThan(f.len);
    expect(st.cross![1]).toBeLessThan(f.len);
  });

  it("abri à chariots du Lidl : emprise de 5 × 7 m sur le parking, côté ouvert au bord du contour, style Lidl", () => {
    const k = kinds.buildings[CART]!, b = bOf(CART);
    expect(k.k).toBe("cart");
    expect(k.style).toBe("lidl");
    const [ox, oy] = k.open!;
    let near = Infinity;
    for (let i = 0; i < b.ring.length / 2; i++) near = Math.min(near, distToEdge(b, i, ox, oy));
    expect(near).toBeLessThan(0.3);
    const sides = Array.from({ length: 4 }, (_, i) => edgeFrame(b.ring, i).len).sort((a, c) => a - c);
    expect(sides[0]).toBeGreaterThan(4.3);
    expect(sides[3]).toBeLessThan(7.5);
  });

  it("obstacles : le sas et le casier bloquent, le mur vitré et la zone hachurée se longent", () => {
    const b = bOf(LIDL), st = kinds.buildings[LIDL]!.store!;
    const c = new Colliders();
    c.addRing(b.ring.reduce<number[]>((a, v) => a.concat(v), []));
    const circles = storeCircles(b, st);
    expect(circles.length).toBe(4);
    for (const [x, y, r] of circles) c.addCircle(x, y, r);
    const f = edgeFrame(b.ring, st.e), g = edgeFrame(b.ring, st.side!.e);
    const at = (e: typeof f, s: number, o: number): [number, number] => [e.x + e.tx * s + e.nx * o, e.y + e.ty * s + e.ny * o];
    // Devant le sas (à 0,8 m) et contre le casier : bloqué ; à 4 m du sas, et le long de la zone hachurée à 2 m du mur : libre.
    expect(c.resolve(...at(f, st.door![0], 0.8), 0.35).hit).toBe(true);
    expect(c.resolve(...at(g, st.side!.locker[0], 0.3), 0.35).hit).toBe(true);
    expect(c.resolve(...at(f, st.door![0], 4), 0.35).hit).toBe(false);
    expect(c.resolve(...at(g, 14, 2.4), 0.35).hit).toBe(false);
    expect(landmarkCircles(kinds, world.tile.buildings).filter(([x, y]) => circles.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 1e-6)).length).toBe(4);
    // La pharmacie n'ajoute pas d'obstacle (sa galerie est dans son contour).
    expect(storeCircles(bOf(PHARMACY), kinds.buildings[PHARMACY]!.store!)).toEqual([]);
  });

  it("passants : un seul point « commerce » par magasin, devant le mur d'entrée, plus d'ancien point sur les autres murs", () => {
    for (const [id, edge] of [[LIDL, 0], [PHARMACY, 0]] as const) {
      const b = bOf(id), n = b.ring.length / 2;
      const near = commerce().filter(([x, y]) => Array.from({ length: n }, (_, e) => distToEdge(b, e, x, y)).some((d) => d < 2));
      expect(near.length).toBe(1);
      const [x, y] = near[0]!;
      expect(distToEdge(b, edge, x, y)).toBeCloseTo(0.8, 0);
      const f = edgeFrame(b.ring, edge);
      expect((x - f.x) * f.nx + (y - f.y) * f.ny).toBeGreaterThan(0);
      for (let e = 1; e < n; e++) expect(distToEdge(b, e, x, y)).toBeGreaterThan(1.5);
    }
  });

  it("aucune cache d'arme dans les magasins, leur sas, leur galerie ni leur abri", () => {
    for (const id of [LIDL, PHARMACY, CART]) {
      const b = bOf(id), n = b.ring.length / 2;
      for (const q of CACHES) expect(Array.from({ length: n }, (_, e) => distToEdge(b, e, q.x, q.y)).every((d) => d > 3)).toBe(true);
    }
  });
});

describe("zone commerciale de Bellevue : But, Bricomarché, Intermarché, Jardinerie (D144)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const BRICO = "BATIMENT0000000348847158", INTER = "BATIMENT0000000348847156", BUT = "BATIMENT0000000348852219", JARD = "BATIMENT0000000348847180";
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const roofAt = (r: [number, number, number, number], x: number, y: number): number => r[0] * x + r[1] * y + r[2];
  const compass = (f: { nx: number; ny: number }): number => ((Math.atan2(f.nx, f.ny) * 180) / Math.PI + 360) % 360;
  const cell = JSON.parse(readFileSync("public/data/nav/s4_10.json", "utf8")) as { poi: number[] };
  const commerce = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < cell.poi.length; i += 5) if (cell.poi[i] === 2) out.push([cell.poi[i + 1]!, cell.poi[i + 2]!]);
    return out;
  };
  const distToRing = (b: { ring: number[] }, x: number, y: number): number => {
    let d = Infinity;
    for (let e = 0; e < b.ring.length / 2; e++) {
      const f = edgeFrame(b.ring, e);
      const s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
      d = Math.min(d, Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o));
    }
    return d;
  };

  it("toits mesurés : plats (moins de 3 % de pente), hauteurs de 5 à 8 m, acrotère de 15 à 70 cm", () => {
    const want: [string, number, number][] = [[BRICO, 6.0, 7.2], [INTER, 7.2, 8.2], [BUT, 4.8, 6.6], [JARD, 5.0, 7.2]];
    for (const [id, lo, hi] of want) {
      const k = kinds.buildings[id]!, b = bOf(id), roof = k.roof!;
      expect(k.k).toBe("retail");
      expect(Math.hypot(roof[0], roof[1])).toBeLessThan(0.03);
      expect(roof[3]).toBeGreaterThanOrEqual(0.15);
      expect(roof[3]).toBeLessThanOrEqual(0.7);
      const h = roofAt(roof, ...(b.ring.slice(0, 2) as [number, number])) - b.ground;
      expect(h).toBeGreaterThan(lo);
      expect(h).toBeLessThan(hi);
    }
  });

  it("l'ancien « Agri Sud Est » est la Jardinerie d'Autun", () => {
    expect(kinds.buildings[JARD]!.n).toBe("Jardinerie d'Autun");
    expect(Object.values(kinds.buildings).some((k) => k.n === "Agri Sud Est")).toBe(false);
    expect(kinds.buildings[JARD]!.store!.style).toBe("jardinerie");
  });

  it("côté des façades : Bricomarché et Intermarché au sud-ouest, But au sud-est, pavillons de la Jardinerie au nord-ouest", () => {
    const want: [string, string, number, number, number, number][] = [
      [BRICO, "bricomarche", 200, 260, 55, 62], [INTER, "intermarche", 200, 260, 22, 25], [BUT, "but", 120, 160, 30, 33], [JARD, "jardinerie", 295, 345, 12, 15],
    ];
    for (const [id, style, c0, c1, l0, l1] of want) {
      const st = kinds.buildings[id]!.store!, f = edgeFrame(bOf(id).ring, st.e);
      expect(st.style).toBe(style);
      expect(compass(f)).toBeGreaterThan(c0);
      expect(compass(f)).toBeLessThan(c1);
      expect(f.len).toBeGreaterThan(l0);
      expect(f.len).toBeLessThan(l1);
      expect(st.glass[0]).toBeGreaterThanOrEqual(0);
      expect(st.glass[1]).toBeLessThanOrEqual(f.len);
      if (st.door) expect(st.door[0] + st.door[1] / 2).toBeLessThanOrEqual(st.glass[1] + 0.01);
    }
    // Bricomarché : entrée centrée sur le mur (au mètre près).
    const bs = kinds.buildings[BRICO]!.store!, bf = edgeFrame(bOf(BRICO).ring, bs.e);
    expect(Math.abs(bs.door![0] - bf.len / 2)).toBeLessThan(1);
    // Jardinerie : le grand pavillon porte la porte, le petit est en retrait ; faîtage plus haut que l'égout.
    const js = kinds.buildings[JARD]!.store!;
    expect(js.pavilions!.length).toBe(2);
    for (const [, s0, s1, eave, ridge] of js.pavilions!) { expect(s1).toBeGreaterThan(s0 + 8); expect(ridge).toBeGreaterThan(eave + 0.8); }
  });

  it("abris solaires de l'Intermarché : six, devant le mur sud-ouest, de 9 à 14 m de large, plan de 8 à 20 % qui monte vers le nord-ouest", () => {
    const all = [BRICO, INTER, JARD].flatMap((id) => kinds.buildings[id]!.store!.carports ?? []);
    expect(all.length).toBe(6);
    const inter = bOf(INTER);
    for (const cp of all) {
      const [x, y, , L, W, a, b] = cp;
      expect(L).toBeGreaterThan(17);
      expect(L).toBeLessThan(28);
      expect(W).toBeGreaterThan(8.5);
      expect(W).toBeLessThan(15);
      const slope = Math.hypot(a, b);
      expect(slope).toBeGreaterThan(0.08);
      expect(slope).toBeLessThan(0.2);
      expect(a).toBeLessThan(0);
      expect(b).toBeGreaterThan(0);
      // Hors des bâtiments, à moins de 60 m de la façade de l'Intermarché.
      for (const id of [BRICO, INTER, BUT, JARD]) expect(distToRing(bOf(id), x, y)).toBeGreaterThan(3);
      expect(distToRing(inter, x, y)).toBeLessThan(60);
      const sh = carportShape(cp);
      expect(sh.posts.length).toBeGreaterThanOrEqual(3);
      // Poteaux sous le bord haut : le dessus y est plus haut qu'au milieu.
      for (const [px, py] of sh.posts) expect(sh.zAt(px, py)).toBeGreaterThan(sh.zAt(x, y));
    }
  });

  it("obstacles : portique et poteaux d'auvent, poteaux des abris, angles des pavillons ; les tondeuses se longent", () => {
    const brico = kinds.buildings[BRICO]!.store!;
    const circles = (id: string): [number, number, number][] => storeCircles(bOf(id), kinds.buildings[id]!.store!);
    // Bricomarché : 2 montants du portique, 1 + ceil(...) poteaux d'auvent, + les abris solaires de sa tuile.
    const own = circles(BRICO).length - (brico.carports ?? []).reduce((n, cp) => n + carportShape(cp).posts.length, 0);
    expect(own).toBe(2 + 7);
    expect(circles(INTER).length).toBe((kinds.buildings[INTER]!.store!.carports ?? []).reduce((n, cp) => n + carportShape(cp).posts.length, 0));
    expect(circles(BUT).length).toBe(2);
    expect(circles(JARD).length).toBeGreaterThanOrEqual(4);
    const f = edgeFrame(bOf(BRICO).ring, brico.e);
    const at = (s: number, o: number): [number, number] => [f.x + f.tx * s + f.nx * o, f.y + f.ty * s + f.ny * o];
    const c = new Colliders();
    for (const [x, y, r] of circles(BRICO)) c.addCircle(x, y, r);
    expect(c.resolve(...at(brico.door![0] - brico.door![1] / 2, 2.3), 0.3).hit).toBe(true);
    // Entre les montants du portique, devant les portes : libre ; en travers d'une tondeuse (à 5 m du mur) : libre aussi.
    expect(c.resolve(...at(brico.door![0], 2.3), 0.3).hit).toBe(false);
    expect(c.resolve(...at(brico.display![0] + 1.5, 5), 0.3).hit).toBe(false);
    // Tous ces cercles sont dans la liste des obstacles de la tuile.
    const all = landmarkCircles(kinds, world.tile.buildings);
    for (const id of [BRICO, INTER, BUT, JARD]) for (const [x, y] of circles(id)) expect(all.some(([ax, ay]) => Math.hypot(ax - x, ay - y) < 1e-6)).toBe(true);
  });

  it("passants : un seul point « commerce » par magasin, du côté de l'entrée et hors des obstacles", () => {
    const pts = commerce();
    for (const [id, minD, maxD] of [[BRICO, 0.5, 1.2], [INTER, 0.5, 1.2], [BUT, 0.5, 1.2], [JARD, 2.5, 3.6]] as const) {
      const b = bOf(id), st = kinds.buildings[id]!.store!;
      const near = pts.filter(([x, y]) => distToRing(b, x, y) < 4.2);
      expect(near.length).toBe(1);
      const [x, y] = near[0]!;
      const d = distToRing(b, x, y);
      expect(d).toBeGreaterThan(minD);
      expect(d).toBeLessThan(maxD);
      for (const [cx, cy, r] of storeCircles(b, st)) expect(Math.hypot(x - cx, y - cy)).toBeGreaterThan(r + 0.4);
    }
    // Le but et la jardinerie ont perdu leur ancien point sur l'autre face : celui du But est bien sur le mur sud-est, pas sud-ouest.
    const but = bOf(BUT), [bx, by] = pts.find(([x, y]) => distToRing(but, x, y) < 2)!;
    const f = edgeFrame(but.ring, 4);
    expect((bx - f.x) * f.nx + (by - f.y) * f.ny).toBeGreaterThan(0.5);
    expect(Math.abs((bx - f.x) * f.tx + (by - f.y) * f.ty - f.len / 2)).toBeLessThan(1);
  });

  it("aucune cache d'arme à moins de 3 m des quatre magasins ni de leurs abris", () => {
    for (const id of [BRICO, INTER, BUT, JARD]) for (const q of CACHES) expect(distToRing(bOf(id), q.x, q.y)).toBeGreaterThan(3);
  });
});

describe("galeries marchandes de Bellevue, GiFi, Action (D145)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const S1 = "BATIMENT0000002222388078", S1C = "BATIMENT0000002222388080", S2A = "BATIMENT0000002222388083", S2B = "BATIMENT0000002479786224", WING = "BATIMENT0000EXTRA0145";
  const GIFI = "BATIMENT0000000357310923", ACT = "BATIMENT0000000348857700";
  const GALLERIES = [S1, S2A, S2B, WING];
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const compass = (f: { nx: number; ny: number }): number => ((Math.atan2(f.nx, f.ny) * 180) / Math.PI + 360) % 360;
  const cell = JSON.parse(readFileSync("public/data/nav/s4_11.json", "utf8")) as { poi: number[] };
  const manual = JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { fronts: Record<string, { pois?: [number, number][] }> };
  const commerce = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < cell.poi.length; i += 5) if (cell.poi[i] === 2) out.push([cell.poi[i + 1]!, cell.poi[i + 2]!]);
    return out;
  };
  const distToRing = (b: { ring: number[] }, x: number, y: number): number => {
    let d = Infinity;
    for (let e = 0; e < b.ring.length / 2; e++) {
      const f = edgeFrame(b.ring, e);
      const s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
      d = Math.min(d, Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o));
    }
    return d;
  };
  const area = (r: number[]): number => {
    let a = 0;
    for (let i = 0; i < r.length; i += 2) a += r[i]! * r[(i + 3) % r.length]! - r[(i + 2) % r.length]! * r[i + 1]!;
    return Math.abs(a) / 2;
  };

  it("l'aile nord-ouest absente de BD TOPO est ajoutée d'après le LiDAR : 50 × 34 m, toit plat à 6 – 7 m, prolonge le mur de l'unité voisine", () => {
    const w = bOf(WING), b = bOf(S2B);
    expect(area(w.ring)).toBeGreaterThan(1500);
    expect(area(w.ring)).toBeLessThan(1900);
    expect(kinds.buildings[WING]!.k).toBe("retail");
    const roof = kinds.buildings[WING]!.roof!;
    expect(Math.hypot(roof[0], roof[1])).toBeLessThan(0.03);
    const h = roof[0] * w.ring[0]! + roof[1] * w.ring[1]! + roof[2] - w.ground;
    expect(h).toBeGreaterThan(5.8);
    expect(h).toBeLessThan(7.2);
    // Deux sommets communs avec l'unité voisine (le mur nord-ouest de l'ancien bâtiment).
    const shared = [0, 1, 2, 3].filter((i) => [0, 1, 2, 3].some((j) => Math.hypot(w.ring[2 * i]! - b.ring[2 * j]!, w.ring[2 * i + 1]! - b.ring[2 * j + 1]!) < 0.2));
    expect(shared.length).toBe(2);
    // L'ajout est idempotent : un seul bâtiment de cet identifiant.
    expect(world.tile.buildings.filter((q) => q.id === WING).length).toBe(1);
  });

  it("toits mesurés : plats (moins de 3 %), de 5 à 7,5 m au-dessus du sol, acrotère de 15 à 70 cm ; l'auvent BD TOPO de 10 m est masqué", () => {
    for (const id of [...GALLERIES, GIFI, ACT]) {
      const k = kinds.buildings[id]!, b = bOf(id), roof = k.roof!;
      expect(k.k).toBe("retail");
      expect(Math.hypot(roof[0], roof[1])).toBeLessThan(0.03);
      expect(roof[3]).toBeGreaterThanOrEqual(0.15);
      expect(roof[3]).toBeLessThanOrEqual(0.7);
      const h = roof[0] * b.ring[0]! + roof[1] * b.ring[1]! + roof[2] - b.ground;
      expect(h).toBeGreaterThan(5);
      expect(h).toBeLessThan(7.5);
    }
    expect(kinds.buildings[S1C]!.k).toBe("hidden");
    expect(isOpen(kinds, S1C)).toBe(true);
  });

  it("côté des façades : galerie sud-ouest au nord-est, galerie nord-est au sud-ouest, GiFi à l'est-sud-est, Action au sud-sud-est", () => {
    const want: [string, string, number, number, number, number][] = [
      [S1, "galerie", 20, 70, 105, 115], [S2A, "galerie", 200, 250, 58, 60], [S2B, "galerie", 200, 250, 42, 45], [WING, "galerie", 200, 250, 49, 51],
      [GIFI, "gifi", 90, 130, 47, 50], [ACT, "action", 150, 185, 70, 73],
    ];
    for (const [id, style, c0, c1, l0, l1] of want) {
      const st = kinds.buildings[id]!.store!, f = edgeFrame(bOf(id).ring, st.e);
      expect(st.style).toBe(style);
      expect(compass(f)).toBeGreaterThan(c0);
      expect(compass(f)).toBeLessThan(c1);
      expect(f.len).toBeGreaterThan(l0);
      expect(f.len).toBeLessThan(l1);
    }
  });

  it("unités : contiguës sur leur arête, dans la longueur du mur, enseignes lues sur les photos ; Intersport est la plus large", () => {
    const names = new Set<string>();
    for (const id of [...GALLERIES, ACT]) {
      const b = bOf(id), us = kinds.buildings[id]!.store!.units!;
      expect(us.length).toBeGreaterThan(0);
      for (const [e, s0, s1, name] of us) {
        expect(s1).toBeGreaterThan(s0 + 3);
        expect(s1).toBeLessThanOrEqual(edgeFrame(b.ring, e).len + 0.01);
        if (name) names.add(name);
      }
      // Pas de recouvrement le long d'une arête.
      for (const [e, s0, s1] of us) for (const [e2, t0, t1] of us) if (e === e2 && (s0 !== t0 || s1 !== t1)) expect(Math.min(s1, t1) - Math.max(s0, t0)).toBeLessThan(0.01);
    }
    for (const n of ["INTERSPORT", "GÉMO", "SCHMIDT", "OPTICAL CENTER", "Générale d'Optique", "Comme j'aime", "CENTRAKOR", "MAXI ZOO", "STOKOMANI", "MAISON de la LITERIE", "ACTION"]) expect(names.has(n)).toBe(true);
    const widths = kinds.buildings[S1]!.store!.units!.map(([, s0, s1]) => s1 - s0);
    const inter = kinds.buildings[S1]!.store!.units!.find((u) => u[3] === "INTERSPORT")!;
    expect(inter[2] - inter[1]).toBeGreaterThanOrEqual(Math.max(...widths.filter((w) => w < 45)));
  });

  it("auvents vitrés : dessus à 8 – 9 m, 2 à 3,5 m de profondeur, poteaux tous les 6 m au plus, de part et d'autre du mur sur toute la longueur de la façade", () => {
    for (const id of [S1, S2A, S2B, WING]) {
      const b = bOf(id), a = kinds.buildings[id]!.store!.arcade!;
      expect(a.z).toBeGreaterThan(8);
      expect(a.z).toBeLessThan(9);
      expect(a.o[1] - a.o[0]).toBeGreaterThan(2);
      expect(a.o[1] - a.o[0]).toBeLessThan(3.5);
      const posts = arcadePosts(b, a);
      expect(posts.length).toBeGreaterThanOrEqual(a.runs.length * 2);
      // Poteaux au bord avant : à 1,2 – 3,1 m du contour, d'un tronçon à l'autre espacés de 6 m au plus.
      for (const [x, y] of posts) {
        expect(distToRing(b, x, y)).toBeGreaterThan(1.1);
        expect(distToRing(b, x, y)).toBeLessThan(3.3);
      }
      for (const run of a.runs) {
        const mine = arcadePosts(b, { ...a, runs: [run] });
        for (let i = 1; i < mine.length; i++) expect(Math.hypot(mine[i]![0] - mine[i - 1]![0], mine[i]![1] - mine[i - 1]![1])).toBeLessThanOrEqual(6.01);
      }
    }
    // La galerie sud-ouest couvre ses deux pans de façade (174 m).
    const runs = kinds.buildings[S1]!.store!.arcade!.runs;
    expect(runs.reduce((n, [, s0, s1]) => n + s1 - s0, 0)).toBeGreaterThan(165);
  });

  it("obstacles : poteaux d'auvent, tour de jeux et banc des deux aires, poteaux d'entrée du GiFi ; le tapis et le trampoline se traversent", () => {
    const circles = (id: string): [number, number, number][] => storeCircles(bOf(id), kinds.buildings[id]!.store!);
    for (const id of [S1, S2A, S2B, WING]) {
      const posts = arcadePosts(bOf(id), kinds.buildings[id]!.store!.arcade!).length;
      const plays = (kinds.buildings[id]!.store!.play ?? []).length * 2;
      expect(circles(id).length).toBe(posts + plays);
    }
    expect(circles(GIFI).length).toBe(2);
    expect(circles(ACT).length).toBe(0);
    const plays = [S1, S2A].flatMap((id) => kinds.buildings[id]!.store!.play ?? []);
    expect(plays.length).toBe(2);
    for (const p of plays) {
      const [tower, bench] = playCircles(p);
      const c = new Colliders();
      c.addCircle(tower![0], tower![1], tower![2]);
      c.addCircle(bench![0], bench![1], bench![2]);
      expect(c.resolve(tower![0], tower![1], 0.3).hit).toBe(true);
      // Le centre du tapis (entre la tour et le banc) est libre ; hors des bâtiments.
      expect(c.resolve(p[0], p[1], 0.3).hit).toBe(false);
      for (const id of [S1, S2A, S2B, WING, GIFI, ACT]) expect(distToRing(bOf(id), p[0], p[1])).toBeGreaterThan(8);
    }
    const all = landmarkCircles(kinds, world.tile.buildings);
    for (const id of [S1, S2A, S2B, WING, GIFI]) for (const [x, y] of circles(id)) expect(all.some(([ax, ay]) => Math.hypot(ax - x, ay - y) < 1e-6)).toBe(true);
    // Une personne passe entre deux poteaux d'auvent (6 m) et sous l'auvent le long du mur.
    const b = bOf(S2A), f = edgeFrame(b.ring, 0), c = new Colliders();
    for (const [x, y, r] of circles(S2A)) c.addCircle(x, y, r);
    for (const s of [3, 9, 21, 32.5]) expect(c.resolve(f.x + f.tx * s + f.nx * 0.8, f.y + f.ty * s + f.ny * 0.8, 0.3).hit).toBe(false);
  });

  it("passants : un point « commerce » par entrée, à 0,5 – 1,2 m du mur, hors des obstacles ; plus aucun ancien point sur le mur de bout", () => {
    const pts = commerce();
    for (const id of [S1, S2A, S2B, WING, GIFI, ACT]) {
      const b = bOf(id);
      const near = pts.filter(([x, y]) => distToRing(b, x, y) < 1.3);
      expect(near.length).toBe(manual.fronts[id]!.pois!.length);
      for (const [x, y] of near) {
        expect(distToRing(b, x, y)).toBeGreaterThan(0.5);
        for (const [cx, cy, r] of storeCircles(b, kinds.buildings[id]!.store!)) expect(Math.hypot(x - cx, y - cy)).toBeGreaterThan(r + 0.3);
      }
    }
    // Chaque point d'une unité tombe devant l'une des unités (entre s0 et s1) de la galerie.
    const b = bOf(S1), us = kinds.buildings[S1]!.store!.units!;
    for (const [x, y] of pts.filter(([px, py]) => distToRing(b, px, py) < 1.3)) {
      const ok = us.some(([e, s0, s1]) => {
        const f = edgeFrame(b.ring, e), s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
        return s >= s0 - 0.5 && s <= s1 + 0.5 && o > 0.4 && o < 1.3;
      });
      expect(ok).toBe(true);
    }
  });

  it("aucune cache d'arme à moins de 3 m des galeries, de GiFi, d'Action ni des aires de jeux", () => {
    for (const id of [S1, S2A, S2B, WING, GIFI, ACT]) for (const q of CACHES) expect(distToRing(bOf(id), q.x, q.y)).toBeGreaterThan(3);
    for (const p of [S1, S2A].flatMap((id) => kinds.buildings[id]!.store!.play ?? [])) for (const q of CACHES) expect(Math.hypot(q.x - p[0], q.y - p[1])).toBeGreaterThan(8);
  });
});

describe("Espace Aubade, Comptoir des Fers, rotonde d'entrée et Norauto (D146)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const AUB = "BATIMENT0000000348852203", ROT = "BATIMENT0000000348852221", NOR = "BATIMENT0000000348852206";
  const H = "BATIMENT0000EXTRA0146H", M = "BATIMENT0000EXTRA0146M", X = "BATIMENT0000EXTRA0146X", F = "BATIMENT0000EXTRA0146F";
  const PIECES = [H, M, X, F];
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const compass = (f: { nx: number; ny: number }): number => ((Math.atan2(f.nx, f.ny) * 180) / Math.PI + 360) % 360;
  const cell = JSON.parse(readFileSync("public/data/nav/s4_10.json", "utf8")) as { poi: number[] };
  const commerce = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < cell.poi.length; i += 5) if (cell.poi[i] === 2) out.push([cell.poi[i + 1]!, cell.poi[i + 2]!]);
    return out;
  };
  const distToRing = (b: { ring: number[] }, x: number, y: number): number => {
    let d = Infinity;
    for (let e = 0; e < b.ring.length / 2; e++) {
      const f = edgeFrame(b.ring, e);
      const s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
      d = Math.min(d, Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o));
    }
    return d;
  };
  const area = (r: number[]): number => {
    let a = 0;
    for (let i = 0; i < r.length; i += 2) a += r[i]! * r[(i + 3) % r.length]! - r[(i + 2) % r.length]! * r[i + 1]!;
    return Math.abs(a) / 2;
  };
  const heightAt = (id: string, x: number, y: number): number => {
    const r = kinds.buildings[id]!.roof!;
    return r[0] * x + r[1] * y + r[2] - bOf(id).ground;
  };

  it("le bâtiment BD TOPO d'Aubade est remplacé par quatre volumes qui le recouvrent exactement, et il est masqué", () => {
    expect(kinds.buildings[AUB]!.k).toBe("hidden");
    expect(isOpen(kinds, AUB)).toBe(true);
    const total = PIECES.reduce((n, id) => n + area(bOf(id).ring), 0);
    expect(Math.abs(total - area(bOf(AUB).ring))).toBeLessThan(6);
    for (const id of PIECES) {
      expect(world.tile.buildings.filter((q) => q.id === id).length).toBe(1);
      expect(kinds.buildings[id]!.k).toBe("retail");
    }
    expect(kinds.buildings[M]!.n).toBe("Comptoir des Fers");
    expect(kinds.buildings[F]!.n).toBe("Espace Aubade");
  });

  it("niveaux de toit mesurés : hangar et Comptoir à 6 – 7,5 m, partie centrale à 4,8 – 6,2 m, salle arrondie à 3,5 – 5 m, rotonde à 3,5 – 5 m ; BD TOPO disait 8,4 m", () => {
    const c = (id: string): [number, number] => {
      const r = bOf(id).ring, n = r.length / 2;
      return [r.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / n, r.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / n];
    };
    for (const [id, lo, hi] of [[H, 6, 7.5], [M, 6, 7.5], [X, 4.8, 6.2], [F, 3.5, 5], [ROT, 3.5, 5]] as [string, number, number][]) {
      const h = heightAt(id, ...c(id));
      expect(h).toBeGreaterThan(lo);
      expect(h).toBeLessThan(hi);
      expect(kinds.buildings[id]!.roof![3]).toBeGreaterThanOrEqual(0.15);
      expect(kinds.buildings[id]!.roof![3]).toBeLessThanOrEqual(0.7);
    }
    // Hangar et Comptoir : même niveau (à 40 cm près).
    expect(Math.abs(heightAt(H, ...c(H)) - heightAt(M, ...c(M)))).toBeLessThan(0.5);
  });

  it("Norauto : toit penché de 2 à 4 % vers le nord-est, façade au nord-est (40 m), quatre portes d'atelier, bloc d'entrée entre deux murs", () => {
    const k = kinds.buildings[NOR]!, st = k.store!, b = bOf(NOR), f = edgeFrame(b.ring, st.e);
    expect(st.style).toBe("norauto");
    const slope = Math.hypot(k.roof![0], k.roof![1]);
    expect(slope).toBeGreaterThan(0.02);
    expect(slope).toBeLessThan(0.04);
    // Plus bas au mur de façade qu'au mur du fond.
    const mid = (e: number): [number, number] => { const g = edgeFrame(b.ring, e); return [g.x + g.tx * g.len / 2, g.y + g.ty * g.len / 2]; };
    expect(heightAt(NOR, ...mid(2))).toBeLessThan(heightAt(NOR, ...mid(0)));
    expect(compass(f)).toBeGreaterThan(30);
    expect(compass(f)).toBeLessThan(70);
    expect(f.len).toBeGreaterThan(39);
    expect(f.len).toBeLessThan(42);
    expect(st.units!.filter((u) => u[6] === "garage").length).toBe(4);
    expect(st.units!.some((u) => u[3] === "Atelier")).toBe(true);
    const [b0, b1] = st.block!;
    expect(b1 - b0).toBeGreaterThan(8);
    expect(b0).toBeGreaterThan(Math.max(...st.units!.map((u) => u[2])));
    expect(b1).toBeLessThan(st.panel![0]);
    expect(st.door![0]).toBeGreaterThan(b0);
    expect(st.door![0]).toBeLessThan(b1);
  });

  it("obstacles : aucun (le bloc d'entrée de Norauto et la rotonde se longent) ; passants : un point devant l'entrée de Norauto et de la rotonde, plus d'ancien point sur le hangar", () => {
    for (const id of [NOR, ROT, H, M, X, F]) expect(storeCircles(bOf(id), kinds.buildings[id]!.store!).length).toBe(0);
    const pts = commerce();
    const nor = pts.filter(([x, y]) => distToRing(bOf(NOR), x, y) < 1.3);
    expect(nor.length).toBe(1);
    const f = edgeFrame(bOf(NOR).ring, 2), [nx, ny] = nor[0]!;
    expect(Math.abs((nx - f.x) * f.tx + (ny - f.y) * f.ty - kinds.buildings[NOR]!.store!.door![0])).toBeLessThan(1);
    expect(distToRing(bOf(NOR), nx, ny)).toBeGreaterThan(0.5);
    expect(pts.filter(([x, y]) => distToRing(bOf(ROT), x, y) < 1.3).length).toBe(1);
    for (const id of PIECES) expect(pts.filter(([x, y]) => distToRing(bOf(id), x, y) < 3).length).toBe(0);
  });

  it("aucune cache d'arme à moins de 3 m des quatre volumes, de la rotonde ni de Norauto", () => {
    for (const id of [...PIECES, ROT, NOR]) for (const q of CACHES) expect(distToRing(bOf(id), q.x, q.y)).toBeGreaterThan(3);
  });

  it("silhouettes lointaines (D145, D146) : l'aile et les quatre volumes d'Aubade y sont, l'ancien volume de 8,4 m n'y est plus", () => {
    const lod = (t: string): { r: number[]; x?: string }[] => JSON.parse(readFileSync(`public/data/lod/${t}.json`, "utf8"));
    expect(lod("16_45").some((r) => r.x === "BATIMENT0000EXTRA0145")).toBe(true);
    const l = lod("18_43"), old = bOf(AUB).ring;
    for (const id of PIECES) expect(l.filter((r) => r.x === id).length).toBe(1);
    expect(l.some((r) => r.r.length === old.length && r.r.every((v, i) => v === old[i]))).toBe(false);
  });
});

describe("Lycée Bonaparte : volumes et toits mesurés (D148)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const MAIN = "BATIMENT0000000348853321", LONG = "BATIMENT0000000348853307", HOUSE = "BATIMENT0000000348853470";
  const ANNEXES = ["BATIMENT0000000348853490", "BATIMENT0000000348853491", "BATIMENT0000000348853507"];
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const wings = (id: string) => kinds.buildings[id]!.college!.wings;

  it("l'ensemble est lu en six ailes : quatre faîtages à 21 m, deux ailes plus basses à 18 m ; l'aile de la rue aux Raz a deux pans bas", () => {
    const w = wings(MAIN);
    expect(w).toHaveLength(6);
    for (const x of w.slice(0, 4)) {
      expect(x.r).toBeGreaterThan(20.5);
      expect(x.r).toBeLessThan(21.5);
    }
    for (const x of w.slice(4)) {
      expect(x.r).toBeGreaterThan(17.5);
      expect(x.r).toBeLessThan(18.5);
    }
    for (const x of w) {
      expect(x.el).toBeLessThan(x.r - 3);
      expect(x.er).toBeLessThan(x.r - 3);
      expect(x.el).toBeGreaterThan(x.r - 6);
    }
    for (const x of wings(LONG)) {
      expect(x.r).toBeGreaterThan(10.5);
      expect(x.r).toBeLessThan(11.2);
    }
  });

  it("chaque aile est sur le contour BD TOPO : son axe tombe à moins de 6 m d'un mur de chaque côté", () => {
    const ring = bOf(MAIN).ring;
    const near = (x: number, y: number): number => {
      let d = Infinity;
      for (let e = 0; e < ring.length / 2; e++) {
        const f = edgeFrame(ring, e);
        const s = (x - f.x) * f.tx + (y - f.y) * f.ty, o = (x - f.x) * f.nx + (y - f.y) * f.ny;
        d = Math.min(d, Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o));
      }
      return d;
    };
    for (const x of wings(MAIN)) for (const t of [0.3, 0.5, 0.7]) expect(near(x.p[0] + (x.q[0] - x.p[0]) * t, x.p[1] + (x.q[1] - x.p[1]) * t)).toBeLessThan(6);
  });

  it("les annexes ont un plan de toit mesuré (pente de moins de 12 %, toit de 2,5 à 9 m au-dessus du sol BD TOPO) ; le bâtiment de la rue Saint-Saulge n'a plus l'enseigne", () => {
    for (const id of ANNEXES) {
      const r = kinds.buildings[id]!.roof!;
      expect(Math.hypot(r[0], r[1])).toBeLessThan(0.12);
      const ring = bOf(id).ring;
      let cx = 0, cy = 0;
      for (let i = 0; i < ring.length; i += 2) {
        cx += ring[i]!;
        cy += ring[i + 1]!;
      }
      cx /= ring.length / 2;
      cy /= ring.length / 2;
      const h = r[0] * cx + r[1] * cy + r[2] - bOf(id).ground;
      expect(h).toBeGreaterThan(2.5);
    expect(h).toBeLessThan(9);
    }
    expect(kinds.buildings[HOUSE]!.main).toBeUndefined();
    expect(kinds.buildings[HOUSE]!.n).toBeUndefined();
  });

  it("aucune cache d'arme à moins de 3 m des bâtiments du lycée", () => {
    for (const id of [MAIN, LONG, ...ANNEXES, HOUSE]) {
      const ring = bOf(id).ring;
      for (const q of CACHES) {
        let d = Infinity;
        for (let e = 0; e < ring.length / 2; e++) {
          const f = edgeFrame(ring, e);
          const s = (q.x - f.x) * f.tx + (q.y - f.y) * f.ty, o = (q.x - f.x) * f.nx + (q.y - f.y) * f.ny;
          d = Math.min(d, Math.hypot(Math.min(Math.max(s, 0), f.len) - s, o));
        }
        expect(d).toBeGreaterThan(3);
      }
    }
  });

  it("l'emprise reste un obstacle (le modèle ne change pas les colliders)", () => {
    const c = new Colliders();
    addTileColliders(c, world.tile, null, world.terrain);
    // Un joueur posé contre le mur est de ce côté : devant la face est de l'aile centrale, à 0,2 m du mur, il touche.
    expect(c.resolve(-110.2, -120.6, 0.3).hit).toBe(true);
  });
});
