import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { buildDevanture } from "./devanture";
import { planFacades } from "./facades";
import { MeshBuilder } from "./geometry";

const { terrain, tile } = loadRealWorld();
const buildings = tile.buildings;
const fiches = new Map(tile.fiches.map((f) => [f.id, f]));

describe("fiches façade", () => {
  it("existent pour chaque bâtiment, avec des séries de murs valides", { timeout: 30_000 }, () => {
    for (const b of buildings) {
      const f = fiches.get(b.id);
      expect(f, b.id).toBeDefined();
      const n = b.ring.length / 2;
      for (const w of f!.walls) {
        const size = w.hole === undefined ? n : b.holes[w.hole]!.length / 2;
        expect(w.a).toBeLessThan(size);
        expect(w.b).toBeLessThan(size);
        expect(w.length).toBeGreaterThan(0);
      }
      for (const s of f!.ground.shops ?? []) expect(s.wall).toBeLessThan(f!.walls.length);
      if (f!.ground.front !== undefined) expect(f!.walls[f!.ground.front]?.role, b.id).toBe("street");
    }
  });
});

describe("planFacades", () => {
  const plan = planFacades(buildings, fiches, terrain);

  it("pose des milliers d'éléments, tous finis", () => {
    expect(plan.stats.windows).toBeGreaterThan(8000);
    expect(plan.stats.doors).toBeGreaterThan(300);
    expect(plan.stats.shops).toBeGreaterThan(100);
    // Un seul expect : des centaines de milliers d'expect ralentissent le test à mesure que le monde grandit.
    const bad = plan.placements.filter((p) => [p.x, p.y, p.z, p.tx, p.ty, p.nx, p.ny].some((v) => !Number.isFinite(v)));
    expect(bad.length).toBe(0);
  });

  it("n'utilise que des sprites demandés", () => {
    const facade = new Set(plan.requests.map((r) => r.key));
    const signs = new Set(plan.signRequests.map((r) => r.key));
    const unknown = plan.placements.filter((p) => !(p.atlas === "facade" ? facade : signs).has(p.key)).map((p) => p.key);
    expect(unknown).toEqual([]);
  });

  it("garde les fenêtres au-dessus du sol", () => {
    const low = plan.placements.filter((p) => p.key.startsWith("win|") && p.z <= terrain.heightAt(p.x, p.y) + 0.1);
    expect(low.length).toBe(0);
  });

  it("pose les vitrines sans nom sur le mur d'entrée de la fiche (D120)", () => {
    // Un commerce sans nom dont le mur d'entrée n'est pas le plus long mur sur rue : ses enseignes doivent regarder le mur d'entrée.
    const f = tile.fiches.find((fi) => {
      if (fi.ground.kind !== "shop" || fi.ground.shops?.length || fi.ground.front === undefined) return false;
      const longest = fi.walls.reduce((best, w, i) => (w.role === "street" && w.hole === undefined && w.length > (fi.walls[best]?.length ?? 0) ? i : best), -1);
      return longest !== fi.ground.front && fi.walls[fi.ground.front]!.length > 6;
    });
    expect(f).toBeDefined();
    const b = buildings.find((x) => x.id === f!.id)!;
    const one = planFacades([b], new Map([[b.id, f!]]), terrain);
    const signs = one.placements.filter((p) => p.atlas === "sign");
    expect(signs.length).toBeGreaterThan(0);
    const w = f!.walls[f!.ground.front!]!, n = b.ring.length / 2;
    const ax = b.ring[2 * w.a]!, ay = b.ring[2 * w.a + 1]!, bx = b.ring[2 * ((w.a + 1) % n)]!, by = b.ring[2 * ((w.a + 1) % n) + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    // Normale sortante de la première arête du mur d'entrée, la même que celle de l'enseigne.
    for (const p of signs) expect(p.nx * ((by - ay) / len) + p.ny * (-(bx - ax) / len)).toBeGreaterThan(0.7);
  });

  it("limite le nombre de sprites distincts (taille de l'atlas)", () => {
    // Sur toute la ville (8 200 bâtiments, D105) : 1 552 sprites distincts. L'atlas est rempli à la demande pour les tuiles proches et
    // recyclé ; ce plafond garde seulement la variété des façades sous contrôle.
    expect(new Set(plan.requests.map((r) => r.key)).size).toBeLessThan(2000);
  });
});

describe("devanture d'après photo (D141) : L'Armoire de Julie, 21 rue Guérin", () => {
  const id = "BATIMENT0000000348856843";
  const f = fiches.get(id)!;
  const d = f.ground.devanture!;

  it("la fiche est un commerce vu sur photo, sa devanture tient dans le mur d'entrée", () => {
    expect(f.status).toBe("observed");
    expect(f.ground.kind).toBe("shop");
    expect(f.ground.shops?.[0]?.name).toBe("L'Armoire de Julie");
    const wall = f.walls[f.ground.front!]!;
    expect(wall.role).toBe("street");
    const width = d.bays.reduce((a, q) => a + q[1], 0);
    expect(d.s0).toBeGreaterThanOrEqual(0);
    expect(d.s0 + width).toBeLessThanOrEqual(wall.length + 0.01);
    // Porte d'immeuble, deux vitrines, porte du magasin, cinq pilastres (photo).
    expect(d.bays.map((q) => q[0]).filter((k) => k !== "pilaster")).toEqual(["door", "window", "shopdoor", "window"]);
    expect(d.sill).toBeLessThan(d.top);
    expect(d.top).toBeLessThan(d.frieze[0] + 0.2);
    expect(d.frieze[1]).toBeLessThan(d.cornice);
    expect(d.cornice).toBeLessThan(d.h);
    expect(d.sign.s[0]).toBeGreaterThanOrEqual(d.s0);
    expect(d.sign.s[1]).toBeLessThanOrEqual(d.s0 + width);
    expect(d.bays[d.label![0]]![0]).toBe("window");
    expect(d.bays[d.number![0]]![0]).toBe("pilaster");
  });

  it("la façade pose la devanture à la place des vitrines génériques, sans fenêtre au rez-de-chaussée derrière", () => {
    const b = buildings.find((q) => q.id === id)!;
    const plan = planFacades([b], fiches, terrain);
    expect(plan.placements.filter((p) => p.key === `dev|${id}`)).toHaveLength(1);
    expect(plan.placements.some((p) => p.key.startsWith("shop|"))).toBe(false);
    const dev = plan.placements.find((p) => p.key === `dev|${id}`)!;
    const onWall = plan.placements.filter((p) => (p.key.startsWith("win|") || p.key.startsWith("door|")) && Math.hypot(p.nx - dev.nx, p.ny - dev.ny) < 0.05);
    expect(onWall.length).toBeGreaterThan(0);
    for (const p of onWall) expect(p.z - dev.z).toBeGreaterThan(d.h - 0.5);
  });

  it("géométrie : sommets finis, coût borné, vitrines allumées la nuit", () => {
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildDevanture(mb, glow, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, "#7389cc");
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(1500);
    expect(glow.positions.length / 9).toBeGreaterThanOrEqual(6);
  });

  it("passants : le point « commerce » est devant la devanture (build_monuments_nav.py)", () => {
    const poi = (JSON.parse(readFileSync("public/data/nav/s6_9.json", "utf8")) as { poi: number[] }).poi;
    let found = false;
    for (let i = 0; i < poi.length; i += 5) if (poi[i] === 2 && Math.hypot(poi[i + 1]! - 127, poi[i + 2]! - 267.2) < 0.5) found = true;
    expect(found).toBe(true);
  });
});
