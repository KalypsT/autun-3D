import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, carportPoint, carportPosts, drawsGenericRoof, isOpen, stationCircles, stationFrame, stationRing, stationShelterColumns, walkableRoof } from "../core/landmarks";
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
    // Cartouches des deux pignons, trois panneaux suspendus (deux faces chacun) sous la marquise et l'abri parapluie.
    expect(texts.sort()).toEqual([...Array<string>(8).fill("AUTUN"), "GARE D'AUTUN"]);
    // three : (x, z, −y) ; tout tient à 2 m des murs mesurés et des quais (abri parapluie, abri vitré), et sous les souches de cheminée.
    const f = stationFrame(m), q = m.quai!;
    const pv = m.parvis!;
    const ring = [...stationRing(m), ...at(f, q.glass[0] - 3, q.sh[3] + 1), ...at(f, q.sh[1] + 1, q.sh[3] + 1), ...at(f, q.glass[0] - 3, m.d),
      // Parvis (D230) : du mur blanc à l'ouest à l'abri de parking à l'est, jusqu'à l'avenue.
      ...at(f, pv.wall[0] - 1, pv.wall[2]), ...at(f, pv.wall[0] - 1, -40), ...at(f, 80, -40), ...at(f, 80, m.d)];
    const xs = ring.filter((_, i) => i % 2 === 0), ys = ring.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 2);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 2);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 2);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 2);
      expect(p[i + 1]!).toBeLessThan(m.pv[1] + 1.4);
    }
  });

  it("quais (D229) : quai 1 jusqu'au mur et quai central au niveau du parvis, abri parapluie et abri vitré", () => {
    const q = m.quai!, f = stationFrame(m);
    expect(q).toBeDefined();
    // Quai 1 de 4 à 5,5 m depuis le mur, quai central de 6 à 8 m ; marquise moins profonde que le quai 1, sous la corniche des ailes.
    expect(q.plat[0]).toBeGreaterThan(4);
    expect(q.plat[0]).toBeLessThan(5.5);
    expect(q.plat[1]).toBeGreaterThan(6);
    expect(q.plat[1]).toBeLessThan(8);
    expect(q.mq[0]).toBeLessThan(q.plat[0]);
    expect(m.g + q.mq[1]).toBeLessThan(m.eave - 0.3);
    // On marche sur les quais à la hauteur du parvis (le relief les porte déjà) : plus de marche de 55 cm.
    for (const [s, t] of [[10, m.d + 1], [40, m.d + 3], [25, q.edges[1] + q.plat[1] / 2]] as const) {
      const [x, y] = at(f, s, t);
      expect(Math.abs(world.terrain.heightAt(x, y) - m.g)).toBeLessThan(0.45);
    }
    const plats = world.tile.structures!.platforms.filter((p) => p.bare);
    expect(plats.length).toBe(2);
    // Abri parapluie : sur le quai central, plus large que lui (il déborde au-dessus des voies), rive vers 4,4 m.
    expect(q.sh[2]).toBeLessThan(q.edges[1]);
    expect(q.sh[3]).toBeGreaterThan(q.edges[1] + q.plat[1] - 1);
    expect(q.sh[4] - m.g).toBeGreaterThan(3.8);
    expect(q.sh[5]).toBeGreaterThan(q.sh[4]);
    const cols = stationShelterColumns(m);
    expect(cols.length).toBeGreaterThanOrEqual(6);
    for (const [, t] of cols) {
      expect(t).toBeGreaterThan(q.edges[1] + 0.5);
      expect(t).toBeLessThan(q.edges[1] + q.plat[1] - 0.5);
    }
    // Le bâtiment BD TOPO qui figurait l'abri est masqué et ne bloque plus ; les colonnes et l'abri vitré sont des obstacles.
    expect(isOpen(world.tile.kinds, "BATIMENT0000000035041726")).toBe(true);
    const c = buildColliders(world.tile);
    const a0 = at(f, q.sh[0] - 2, q.sh[3] - 0.5), a1 = at(f, q.sh[1] + 2, q.sh[3] - 0.5);
    expect(c.raycast(a0[0], a0[1], a1[0], a1[1], true)).toBeNull();
    const [cs, ct] = cols[0]!;
    const b0 = at(f, cs, ct - 2), b1 = at(f, cs, ct + 0.5);
    expect(c.raycast(b0[0], b0[1], b1[0], b1[1], true)).not.toBeNull();
    expect(stationCircles(m).length).toBeGreaterThanOrEqual(cols.length + 3);
    // Traversée à niveau du quai 1 au quai central.
    expect(q.cross[1]).toBeCloseTo(q.edges[0], 0);
    expect(q.cross[2]).toBeGreaterThan(q.cross[1] + 4);
  });

  it("parvis (D230) : abri de parking mesuré, obstacles du mobilier, mur blanc", () => {
    const p = m.parvis!, f = stationFrame(m);
    expect(p).toBeDefined();
    // Abri de parking : environ 16 × 7,6 m, bord bas vers 2,4 m, haut vers 4,4 m au-dessus du parvis.
    const [, , , , L, W, zLo, zHi] = p.carport;
    expect(L).toBeGreaterThan(14);
    expect(L).toBeLessThan(18);
    expect(W).toBeGreaterThan(6.5);
    expect(W).toBeLessThan(9);
    expect(zLo - m.g).toBeGreaterThan(2);
    expect(zHi - m.g).toBeLessThan(5);
    expect(zHi).toBeGreaterThan(zLo + 1);
    const posts = carportPosts(p);
    expect(posts.length).toBeGreaterThanOrEqual(8);
    expect(stationCircles(m).length).toBe(stationShelterColumns(m).length + 3 + p.lamps.length + p.planters.length + 2 + 3 + posts.length);
    // On ne traverse pas le mur blanc ; on passe le long.
    const c = buildColliders(world.tile);
    const [s0, s1, t] = p.wall;
    const a = at(f, (s0 + s1) / 2, t - 2), b = at(f, (s0 + s1) / 2, t + 2);
    expect(c.raycast(a[0], a[1], b[0], b[1])).not.toBeNull();
    // Un poteau de l'abri de parking bloque.
    const [pu, pw] = posts[0]!, [ps, pt] = carportPoint(p, pu, pw);
    const q0 = at(f, ps - 1.5, pt), q1 = at(f, ps + 1.5, pt);
    expect(c.raycast(q0[0], q0[1], q1[0], q1[1], true)).not.toBeNull();
  });
});
