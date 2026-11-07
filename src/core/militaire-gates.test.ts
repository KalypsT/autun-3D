import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { loadRealWorld } from "./testing";
import { addTileColliders, wallTop } from "./world";
import { MeshBuilder } from "../render/geometry";
import { buildCollege } from "../render/monuments";

/** D260 : Lycée militaire, lot 3 de docs/plans/lycee-militaire.md : entrées (build_militaire_gates.py, `gates` du modèle). */
describe("Lycée militaire : entrées (D260)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const gates = spec.mil!.gates!;
  const wall = (id: number) => world.tile.walls.find((w) => w.id === id)!;
  const end = (pts: number[]): [number, number] => [pts[pts.length - 2]!, pts[pts.length - 1]!];
  const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

  it("avenue : grille de 2,6 m sur muret de 0,8 m, coupée entre les deux piles du grand portail ; on ne l'escalade pas", () => {
    const [a, b] = [wall(249238889), wall(-880000002)];
    for (const w of [a, b]) {
      expect(w.kind).toBe("fence");
      expect(w.height).toBe(2.6);
      expect(wallTop(w.kind, w.height).climb).toBe(false);
    }
    expect(dist(end(a.pts), gates.avenue.a)).toBeLessThan(0.05);
    expect(dist(b.pts, gates.avenue.b)).toBeLessThan(0.05);
    for (const id of [-880000003, -880000004]) {
      expect(wall(id).kind).toBe("wall");
      expect(wall(id).height).toBe(0.8);
    }
    expect(dist(gates.avenue.a, gates.avenue.b)).toBeGreaterThan(8);
  });

  it("rue Gaston Joliet : clôture ouverte sur plus de 5 m entre les deux piles, au droit du portail OpenStreetMap", () => {
    const [a, b] = [wall(249238898), wall(-880000001)];
    expect(dist(end(a.pts), gates.joliet.a)).toBeLessThan(0.05);
    expect(dist(b.pts, gates.joliet.b)).toBeLessThan(0.05);
    expect(dist(gates.joliet.a, gates.joliet.b)).toBeGreaterThan(5);
    const mid = [(gates.joliet.a[0] + gates.joliet.b[0]) / 2, (gates.joliet.a[1] + gates.joliet.b[1]) / 2];
    expect(dist(mid, [544.3, -30.6])).toBeLessThan(1.5);
  });

  it("obstacles : on passe à pied par l'entrée Gaston Joliet, pas par le grand portail fermé", () => {
    const c = new Colliders();
    addTileColliders(c, world.tile);
    const [ja, jb] = [gates.joliet.a, gates.joliet.b];
    // Dans l'axe de l'entrée, de 3 m dehors à 3 m dedans : aucun contact pour un piéton (rayon 0,35 m).
    const mx = (ja[0] + jb[0]) / 2, my = (ja[1] + jb[1]) / 2;
    const L = dist(ja, jb), nx = -(jb[1] - ja[1]) / L, ny = (jb[0] - ja[0]) / L;
    for (let k = -3; k <= 3; k += 0.5) expect(c.resolve(mx + nx * k, my + ny * k, 0.35).hit).toBe(false);
    // Au milieu du grand portail : contact, et le segment touché ne s'escalade pas.
    const ax = (gates.avenue.a[0] + gates.avenue.b[0]) / 2, ay = (gates.avenue.a[1] + gates.avenue.b[1]) / 2;
    const r = c.resolve(ax, ay, 0.35);
    expect(r.hit).toBe(true);
    expect(r.wall ?? -1).toBe(-1);
  });

  it("le bâtiment blanc de l'entrée n'a plus de vitrine ; portails dessinés en moins de 5 000 triangles", () => {
    const fi = world.tile.fiches.find((f) => f.id === "BATIMENT0000000348844665")!;
    expect(fi.ground.kind).toBe("dwelling");
    expect(fi.ground.shopfront).toBeUndefined();
    expect(fi.status).toBe("observed");
    const b = world.tile.buildings.find((q) => q.id === ID)!;
    const count = (s: typeof spec): number => {
      const mb = new MeshBuilder();
      buildCollege(mb, new MeshBuilder(), s, b.ring, world.terrain, b.holes);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      return mb.positions.length / 9;
    };
    const mil = { ...spec.mil! };
    delete mil.gates;
    const cost = count(spec) - count({ ...spec, mil });
    expect(cost).toBeGreaterThan(1000);
    expect(cost).toBeLessThan(5000);
  });
});
