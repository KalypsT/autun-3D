import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, isOpen, walkableRoof } from "../core/landmarks";
import { nautiqueFrame, nautiqueLines, nautiqueRings, roofAt } from "../core/nautique";
import { buildColliders } from "../core/world";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import { buildNautique } from "./nautique";
import type { SignAtlas } from "./sign-atlas";
import type { NautiqueBlock } from "../data/types";

const MAIN = "BATIMENT0000000348847357";

const sinks = (texts: string[] = []): LandmarkSinks => {
  const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  return { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
};

describe("Base nautique du plan d'eau du Vallon (D245)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[MAIN]!;
  const m = kind.naut!;
  const f = nautiqueFrame(m);
  const ground = (s: number, t: number): number => world.terrain.heightAt(...at(f, s, t));
  const block = (n: string): NautiqueBlock => m.blocks.find((b) => b.n === n)!;

  it("neuf volumes à un niveau, de 3 à 6 m, le porche BD TOPO masqué", () => {
    expect(m.blocks).toHaveLength(9);
    for (const b of m.blocks) {
      const cs = (b.r[0] + b.r[1]) / 2, ct = (b.r[2] + b.r[3]) / 2, g = ground(cs, ct);
      expect(b.z - g, b.n).toBeGreaterThan(2.5);
      expect(b.z - g, b.n).toBeLessThan(5);
      if (b.ridge !== undefined) {
        expect(b.ridge, b.n).toBeGreaterThan(b.z + 1);
        expect(b.ridge - g, b.n).toBeLessThan(6.5);
      }
    }
    expect(isOpen(world.tile.kinds, "BATIMENT0000000348847358")).toBe(true);
    expect(replacesFacade(kind)).toBe(true);
    expect(walkableRoof(kind)).toBe(false);
  });

  it("toits : pavillon au sommet au centre, deux pans au faîtage, un pan haut à l'ouest ; égouts aux bords", () => {
    const h = block("hangar"), mi = block("milieu"), ne = block("nord-est");
    expect(roofAt(h, (h.r[0] + h.r[1]) / 2, (h.r[2] + h.r[3]) / 2)).toBeCloseTo(h.ridge!, 5);
    expect(roofAt(h, h.r[0], h.r[2] + 3)).toBeCloseTo(h.z, 5);
    expect(roofAt(mi, 15, mi.at!)).toBeCloseTo(mi.ridge!, 5);
    expect(roofAt(mi, 15, mi.r[2])).toBeCloseTo(mi.z, 5);
    expect(roofAt(mi, 15, mi.r[3])).toBeCloseTo(mi.z, 5);
    expect(roofAt(ne, ne.r[0], 25)).toBeCloseTo(ne.ridge!, 5);
    expect(roofAt(ne, ne.r[1], 25)).toBeCloseTo(ne.z, 5);
  });

  it("les volumes ne se chevauchent pas et couvrent le contour BD TOPO à 1,5 m près", () => {
    for (const a of m.blocks) {
      for (const b of m.blocks) {
        if (a === b) continue;
        const ov = Math.min(a.r[1], b.r[1]) - Math.max(a.r[0], b.r[0]), ot = Math.min(a.r[3], b.r[3]) - Math.max(a.r[2], b.r[2]);
        expect(ov > 0.05 && ot > 0.05, `${a.n} / ${b.n}`).toBe(false);
      }
    }
    const main = world.tile.buildings.find((b) => b.id === MAIN)!;
    for (let i = 0; i < main.ring.length; i += 2) {
      const x = main.ring[i]!, y = main.ring[i + 1]!;
      const s = (x - f.x) * f.ux + (y - f.y) * f.uy, t = (x - f.x) * f.vx + (y - f.y) * f.vy;
      const d = Math.min(...m.blocks.map((b) => Math.hypot(Math.max(b.r[0] - s, 0, s - b.r[1]), Math.max(b.r[2] - t, 0, t - b.r[3]))));
      expect(d, `sommet (${x}, ${y})`).toBeLessThan(1.5);
    }
  });

  it("obstacles : on bute contre chaque volume, les toilettes, le mât ; la barrière arrête", () => {
    const colliders = buildColliders(world.tile);
    for (const b of m.blocks) {
      const cs = (b.r[0] + b.r[1]) / 2, mid = at(f, cs, (b.r[2] + b.r[3]) / 2);
      // Depuis 4 m au sud du hangar, au nord des autres (côté libre : la darse et les toilettes).
      const out = at(f, cs, b.n === "hangar" ? b.r[2] - 4 : b.n === "ouest" ? (b.r[2] + b.r[3]) / 2 : b.r[3] + 4);
      const from = b.n === "ouest" ? at(f, b.r[0] - 4, (b.r[2] + b.r[3]) / 2) : out;
      expect(colliders.raycast(from[0], from[1], mid[0], mid[1]), b.n).not.toBeNull();
    }
    expect(nautiqueRings(m).length).toBe(9 + 2 + m.site!.rocks.length + m.site!.bollards.length);
    const [ws, wt] = m.site!.wc, wcIn = at(f, ws, wt), wcOut = at(f, ws, wt + 4);
    expect(colliders.raycast(wcOut[0], wcOut[1], wcIn[0], wcIn[1])).not.toBeNull();
    const { a, b } = m.site!.barrier, mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // La barrière coupe l'allée (on la voit à travers : la vue ne la compte pas, le pas si).
    const [x0, y0] = at(f, mid[0] - 2, mid[1]), [x1, y1] = at(f, mid[0] + 2, mid[1]);
    const lines = nautiqueLines(m);
    expect(lines).toHaveLength(1);
    const [ax, ay, bx, by] = lines[0]!;
    const d1 = (bx! - ax!) * (y0 - ay!) - (by! - ay!) * (x0 - ax!), d2 = (bx! - ax!) * (y1 - ay!) - (by! - ay!) * (x1 - ax!);
    const d3 = (x1 - x0) * (ay! - y0) - (y1 - y0) * (ax! - x0), d4 = (x1 - x0) * (by! - y0) - (y1 - y0) * (bx! - x0);
    expect(d1 * d2 < 0 && d3 * d4 < 0).toBe(true);
  });

  it("dessin fini et borné ; banderole et plaque demandées à l'atlas", () => {
    const texts: string[] = [];
    const s = sinks(texts);
    buildNautique(s, m, world.terrain);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
    expect(s.solid.triangleCount).toBeGreaterThan(1500);
    expect(s.solid.triangleCount).toBeLessThan(9000);
    expect(s.glow.triangleCount).toBeGreaterThan(0);
    expect(texts).toEqual(expect.arrayContaining(["COMMUNE SPORTIVE", "BOURGOGNE-FRANCHE-COMTÉ", "Toilettes"]));
  });
});
