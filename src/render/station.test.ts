import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, drawsGenericRoof, stationFrame, stationRing, walkableRoof } from "../core/landmarks";
import { pointInRing } from "../core/collision";
import { buildColliders } from "../core/world";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildStation } from "./station";

const ID = "BATIMENT0000000348856379";

const area = (r: readonly number[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
  }
  return a / 2;
};

describe("gare (D228)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[ID]!;
  const m = kind.sta!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;

  it("volumes mesurés plausibles (photos et relevé)", () => {
    expect(m).toBeDefined();
    expect(kind.k).toBe("station");
    // Corps d'environ 58 m le long des voies, 8 à 9 m de profondeur ; pavillon d'environ 15 m au milieu, qui déborde des deux côtés.
    expect(m.l).toBeGreaterThan(54);
    expect(m.l).toBeLessThan(62);
    expect(m.d).toBeGreaterThan(7);
    expect(m.d).toBeLessThan(10);
    const [p0, p1, q0, q1] = m.pav;
    expect(p1 - p0).toBeGreaterThan(13);
    expect(p1 - p0).toBeLessThan(17);
    expect(Math.abs((p0 + p1) / 2 - m.l * 0.44)).toBeLessThan(4);
    expect(q0).toBeLessThan(0);
    expect(q1).toBeGreaterThan(m.d);
    // Retour vers le parvis au bout est.
    expect(m.ret[0]).toBeGreaterThan(p1 + 10);
    expect(m.ret[1]).toBeLessThan(-10);
    // Ailes basses (égout vers 5 m), pavillon à deux niveaux (corniche vers 9 m), fronton sous le faîtage.
    expect(m.eave - m.g).toBeGreaterThan(4.3);
    expect(m.eave - m.g).toBeLessThan(5.8);
    expect(m.ridge).toBeGreaterThan(m.eave + 1.5);
    expect(m.pv[0] - m.g).toBeGreaterThan(8);
    expect(m.pv[0] - m.g).toBeLessThan(10);
    expect(m.pv[1]).toBeGreaterThan(m.pv[0] + 2);
    expect(m.ped[1]).toBeGreaterThan(m.pv[0] + 1);
    expect(m.ped[1]).toBeLessThan(m.pv[1]);
    expect(m.ped[0]).toBeGreaterThan(3);
    expect(m.ped[0]).toBeLessThan((p1 - p0) / 2);
    expect(drawsGenericRoof(kind)).toBe(false);
    expect(walkableRoof(kind)).toBe(false);
    expect(replacesFacade(kind)).toBe(true);
  });

  it("obstacle : les murs mesurés, à peu près à la place de l'emprise BD TOPO, façade sur le parvis", () => {
    const ring = stationRing(m);
    expect(area(ring)).toBeGreaterThan(0);
    expect(Math.abs(area(ring) / Math.abs(area(b.ring)) - 1)).toBeLessThan(0.2);
    // Le contour BD TOPO est décalé d'environ 1,2 m vers les voies : le milieu de la façade mesurée tombe à moins de 3 m de lui.
    const f = stationFrame(m);
    const mid = at(f, (m.pav[0] + m.pav[1]) / 2, m.d / 2);
    expect(pointInRing(mid[0], mid[1], b.ring)).toBe(true);
    // La façade regarde le parvis (sud-est) : la normale sortante (−t) pointe vers le sud-est.
    const [x0, y0] = at(f, 10, 0), [x1, y1] = at(f, 10, -1);
    expect(x1 - x0).toBeGreaterThan(0.4);
    expect(y1 - y0).toBeLessThan(-0.4);
    // On n'entre pas dans le pavillon par la façade ; on longe la façade sur le parvis sans rien heurter.
    const c = buildColliders({ ...world.tile, buildings: [b] });
    const pm = (m.pav[0] + m.pav[1]) / 2;
    const out = at(f, pm, m.pav[2] - 3), inPav = at(f, pm, m.pav[2] + 1);
    expect(c.raycast(out[0], out[1], inPav[0], inPav[1])).not.toBeNull();
    const a0 = at(f, m.pav[0] - 2, m.pav[2] - 0.6), a1 = at(f, m.pav[1] + 2, m.pav[2] - 0.6);
    expect(c.raycast(a0[0], a0[1], a1[0], a1[1])).toBeNull();
  });

  it("géométrie : sommets finis, près de l'emprise, coût borné, inscriptions", () => {
    const texts: string[] = [];
    const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
    const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
    buildStation(sinks, m, world.terrain);
    const p = sinks.solid.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    const tris = p.length / 9;
    expect(tris).toBeGreaterThan(1500);
    expect(tris).toBeLessThan(12000);
    expect(sinks.glow.positions.length).toBeGreaterThan(0);
    expect(texts.sort()).toEqual(["AUTUN", "AUTUN", "GARE D'AUTUN"]);
    // three : (x, z, −y) ; tout tient à 2 m des murs mesurés, et sous les souches de cheminée.
    const ring = stationRing(m);
    const xs = ring.filter((_, i) => i % 2 === 0), ys = ring.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 2);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 2);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 2);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 2);
      expect(p[i + 1]!).toBeLessThan(m.pv[1] + 1.4);
    }
  });
});
