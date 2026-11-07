import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { militairePassage } from "./landmarks";
import { loadRealWorld } from "./testing";
import { addTileColliders } from "./world";
import { MeshBuilder } from "../render/geometry";
import { buildCollege } from "../render/monuments";

/** D263 : Lycée militaire, lot 6 de docs/plans/lycee-militaire.md : passage voûté ouvert, enceinte fermée. */
describe("Lycée militaire : passage voûté et enceinte (D263)", () => {
  const world = loadRealWorld();
  const ID = "BATIMENT0000000348844252";
  const spec = world.tile.kinds!.buildings[ID]!.college!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;
  const c = new Colliders();
  addTileColliders(c, world.tile);
  const pass = militairePassage(b, spec)!;

  it("le contour et la cour d'honneur sont coupés de la largeur du passage ; l'autre cour reste fermée", () => {
    const pw = spec.mil!.gallery.pw;
    const gap = (l: number[]): number => Math.hypot(l[0]! - l[l.length - 2]!, l[1]! - l[l.length - 1]!);
    expect(gap(pass.outer)).toBeCloseTo(pw, 1);
    expect(gap(pass.cut)).toBeCloseTo(pw, 1);
    expect(pass.holes).toHaveLength(b.holes.length - 1);
    for (const s of pass.sides) expect(Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!)).toBeGreaterThan(10);
  });

  it("à pied, on va du glacis à la cour d'honneur par le passage ; ses murs arrêtent le piéton sur les côtés", () => {
    const [ox, oy, ix, iy] = pass.axis;
    const D = Math.hypot(ix - ox, iy - oy), dx = (ix - ox) / D, dy = (iy - oy) / D;
    for (let d = -3; d <= D + 3; d += 0.5) expect(c.resolve(ox + dx * d, oy + dy * d, 0.35).hit).toBe(false);
    const hw = spec.mil!.gallery.pw / 2, mx = ox + dx * D / 2, my = oy + dy * D / 2;
    for (const s of [1, -1]) expect(c.resolve(mx - dy * s * (hw + 0.1), my + dx * s * (hw + 0.1), 0.35).hit).toBe(true);
  });

  it("l'enceinte est fermée : en travers de sa limite, un rayon de 8 m touche un mur partout, sauf à l'entrée de la rue Gaston Joliet", () => {
    const site = (JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { militaireGates: { enceinte: [number, number][] } }).militaireGates.enceinte;
    const open: [number, number, number][] = [];
    let run: [number, number] | null = null, len = 0;
    for (let i = 0; i < site.length; i++) {
      const [ax, ay] = site[i]!, [bx, by] = site[(i + 1) % site.length]!, L = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / L, ny = (bx - ax) / L;
      for (let s = 0; s < L; s += 0.5) {
        const x = ax + ((bx - ax) * s) / L, y = ay + ((by - ay) * s) / L;
        const blocked = c.raycast(x - nx * 4, y - ny * 4, x + nx * 4, y + ny * 4) !== null || c.resolve(x, y, 0.5).hit;
        if (!blocked) {
          run ??= [x, y];
          len += 0.5;
        } else if (run) {
          if (len > 1.5) open.push([run[0], run[1], len]);
          run = null;
          len = 0;
        }
      }
    }
    expect(open).toHaveLength(1);
    expect(Math.hypot(open[0]![0] - 544.3, open[0]![1] + 30.6)).toBeLessThan(3);
  });

  it("le bâtiment, passage compris, reste fini et sous 24 000 triangles", () => {
    const mb = new MeshBuilder();
    buildCollege(mb, new MeshBuilder(), spec, b.ring, world.terrain, b.holes);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(24000);
  });
});
