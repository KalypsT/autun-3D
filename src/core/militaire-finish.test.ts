import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { treesOutsideMonuments } from "./landmarks";
import { loadRealWorld } from "./testing";
import { addTileColliders } from "./world";
import { MeshBuilder } from "../render/geometry";
import { buildCollege } from "../render/monuments";

/** D264 : Lycée militaire, finitions : coins des toits à l'aplomb des murs, massifs, lierre, arbres en rideau, drapeaux, barrières en X. */
describe("Lycée militaire : finitions (D264)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;
  const ring: [number, number][] = [];
  for (let i = 0; i < b.ring.length; i += 2) ring.push([b.ring[i]!, b.ring[i + 1]!]);
  const corner = (k: number, u: number, side: number): [number, number] => {
    const w = spec.wings[k]!, L = Math.hypot(w.q[0] - w.p[0], w.q[1] - w.p[1]), ux = (w.q[0] - w.p[0]) / L, uy = (w.q[1] - w.p[1]) / L;
    const v = side > 0 ? w.wl : -w.wr;
    return [w.p[0] + ux * u * L - uy * v, w.p[1] + uy * u * L + ux * v];
  };
  const nearest = (p: [number, number]): number => Math.min(...ring.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));

  it("les coins extérieurs des toits des pavillons tombent sur les coins des murs (à 0,8 m près)", () => {
    // Pavillon nord : coin nord (face nord-ouest et face nord-est) ; pavillon ouest : ses deux coins de la face nord-ouest.
    expect(nearest(corner(0, 0, 1))).toBeLessThan(0.8);
    expect(nearest(corner(1, 0, 1))).toBeLessThan(0.8);
    expect(nearest(corner(1, 0, -1))).toBeLessThan(0.8);
  });

  it("la face nord-est est à l'aplomb du bord du toit : chaque mur qui longe l'aile nord-est est à 4,6 m (± 0,3) de son faîtage", () => {
    const w = spec.wings[2]!, L = Math.hypot(w.q[0] - w.p[0], w.q[1] - w.p[1]), ux = (w.q[0] - w.p[0]) / L, uy = (w.q[1] - w.p[1]) / L;
    const v = (x: number, y: number): number => (x - w.p[0]) * -uy + (y - w.p[1]) * ux;
    const outer = ring.filter(([x, y]) => v(x, y) > 3 && v(x, y) < 6 && (x - w.p[0]) * ux + (y - w.p[1]) * uy > 2 && (x - w.p[0]) * ux + (y - w.p[1]) * uy < L - 2);
    expect(outer.length).toBeGreaterThan(1);
    for (const [x, y] of outer) expect(Math.abs(v(x, y) - 4.6)).toBeLessThan(0.3);
    expect(w.wl).toBeCloseTo(4.6, 1);
  });

  it("arbres en rideau : retirés des arbres génériques, troncs en obstacles ; barrières en X enjambables", () => {
    const pl = spec.mil!.garden!.pleached!.trees;
    expect(pl.length).toBeGreaterThan(40);
    const kept = new Set(treesOutsideMonuments(world.tile.kinds, world.tile.trees).map(([x, y]) => `${x},${y}`));
    for (const [x, y] of pl) expect(kept.has(`${x},${y}`)).toBe(false);
    const c = new Colliders();
    addTileColliders(c, world.tile);
    for (const [x, y] of pl.slice(0, 5)) expect(c.resolve(x, y, 0.2).hit).toBe(true);
    for (const [x, y] of spec.mil!.gates!.joliet.xb ?? []) {
      const r = c.resolve(x, y, 0.3);
      expect(r.hit).toBe(true);
      expect(r.wall ?? -1).toBeGreaterThanOrEqual(0);
    }
    // Lierre du talus : une haie basse le long de l'intérieur de la grille.
    const ivy = world.tile.walls.find((w) => w.id === -880000007)!;
    expect(ivy.kind).toBe("hedge");
    expect(Math.hypot(ivy.pts[2]! - ivy.pts[0]!, ivy.pts[3]! - ivy.pts[1]!)).toBeGreaterThan(100);
  }, 20000); // ≈ 4 s seul, plus de 5 s sous la charge de toute la suite (CI de la PR #91).

  it("massifs, drapeaux, barrières et arbres en rideau : finis, moins de 6 000 triangles", () => {
    const count = (s: typeof spec): number => {
      const mb = new MeshBuilder();
      buildCollege(mb, new MeshBuilder(), s, b.ring, world.terrain, b.holes);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      return mb.positions.length / 9;
    };
    const garden = { ...spec.mil!.garden! };
    delete garden.pleached;
    delete garden.beds;
    const gates = { ...spec.mil!.gates!, joliet: { ...spec.mil!.gates!.joliet } };
    delete gates.flags;
    delete gates.joliet.xb;
    const cost = count(spec) - count({ ...spec, mil: { ...spec.mil!, garden, gates } });
    expect(spec.mil!.gates!.flags).toHaveLength(6);
    expect(cost).toBeGreaterThan(1000);
    expect(cost).toBeLessThan(6000);
  });
});
