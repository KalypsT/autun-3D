import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, bowlingBlocks, bowlingFrame, bowlingHallWalls, bowlingRings, drawsGenericRoof, isOpen, mcdoFrame, mcdoRings, mcdoVerandaOutline, roadsideLines, walkableRoof } from "../core/landmarks";
import { pointInRing } from "../core/collision";
import { buildColliders } from "../core/world";
import { buildBowling, buildMcdo } from "./roadside";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";

const MCDO = "BATIMENT0000000348847408", BOWL = "BATIMENT0000000348847403", HIDDEN = "BATIMENT0000000348847402";

/** Puits de géométrie ; `texts` reçoit les inscriptions demandées à l'atlas. */
const sinks = (texts: string[] = []): LandmarkSinks => {
  const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  return { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
};

/** Sommets (x, y du monde) de la géométrie : three est en (x, z, −y). */
function bounds(p: Float32Array | number[]): { x0: number; x1: number; y0: number; y1: number; z1: number } {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    b.x0 = Math.min(b.x0, p[i]!); b.x1 = Math.max(b.x1, p[i]!);
    b.y0 = Math.min(b.y0, -p[i + 2]!); b.y1 = Math.max(b.y1, -p[i + 2]!);
    b.z1 = Math.max(b.z1, p[i + 1]!);
  }
  return b;
}

describe("McDonald's de la route de Chalon (D234, D235)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[MCDO]!;
  const m = kind.mcd!;
  const b = world.tile.buildings.find((q) => q.id === MCDO)!;

  it("volumes mesurés plausibles (photos et relevé)", () => {
    expect(m).toBeDefined();
    // Corps d'environ 17 × 27 m, le petit côté sur la route ; mansarde de 2,7 à 5,5 m autour d'un toit plat plus bas que son faîte.
    expect(m.l).toBeGreaterThan(15);
    expect(m.l).toBeLessThan(19);
    expect(m.d).toBeGreaterThan(25);
    expect(m.d).toBeLessThan(30);
    expect(m.eave - m.g).toBeGreaterThan(2.2);
    expect(m.crest - m.g).toBeGreaterThan(4.8);
    expect(m.crest - m.g).toBeLessThan(6.5);
    expect(m.roof).toBeLessThan(m.crest - 1);
    expect(m.band).toBeGreaterThan(2);
    expect(m.band).toBeLessThan(4);
    for (const [s0, s1, t0, t1, z] of m.units) {
      expect(s0).toBeGreaterThan(m.band - 0.5);
      expect(s1).toBeLessThan(m.l - m.band + 0.5);
      expect(t0).toBeGreaterThan(m.band - 0.5);
      expect(t1).toBeLessThan(m.d - m.band + 0.5);
      expect(z).toBeGreaterThan(m.roof);
    }
    // Véranda : plus basse que la mansarde, faîtage au-dessus de l'égout et de la noue ; côté route (t < 0) et côté ouest (s < 0).
    const v = m.ver;
    expect(v.o.length).toBe(v.r.length);
    expect(v.o.length).toBe(v.i.length);
    expect(v.ridge).toBeGreaterThan(v.eave);
    expect(v.ridge).toBeGreaterThan(v.gut);
    expect(v.ridge).toBeLessThan(m.crest);
    expect(Math.min(...v.o.map((p) => p[1]))).toBeLessThan(-2.5);
    expect(Math.min(...v.o.map((p) => p[0]))).toBeLessThan(-2.5);
    expect(drawsGenericRoof(kind)).toBe(false);
    expect(walkableRoof(kind)).toBe(false);
    expect(replacesFacade(kind)).toBe(true);
    // Le petit côté sur la route regarde le sud-sud-ouest : la normale sortante (−t) pointe vers le sud.
    const f = mcdoFrame(m), [x0, y0] = at(f, 5, 0), [, y1] = at(f, 5, -1);
    expect(y1 - y0).toBeLessThan(-0.7);
    expect(pointInRing(...at(f, m.l / 2, m.d / 2), b.ring)).toBe(true);
    expect(Number.isFinite(x0)).toBe(true);
  });

  it("obstacles : le corps et la véranda, on n'y entre pas depuis le parking ni depuis la route", () => {
    const rings = mcdoRings(m);
    // Corps, véranda ; totem, deux poteaux du portique, deux panneaux du menu (D235).
    // + pieds des parasols et des lanternes, gros pot, deux poteaux du panneau « DRIVE » (D236).
    expect(rings.length).toBe(2 + 1 + 2 + m.site!.menus.length + m.site!.parasols!.length + m.site!.lamps!.length + 1 + 2);
    expect(mcdoVerandaOutline(m).length).toBeGreaterThan(5);
    const f = mcdoFrame(m);
    const c = buildColliders({ ...world.tile, buildings: [b] });
    const out = at(f, m.l + 8, m.d / 2), inside = at(f, m.l / 2, m.d / 2);
    expect(c.raycast(out[0], out[1], inside[0], inside[1])).not.toBeNull();
    const road = at(f, 4, -12), ver = at(f, 4, -1.5);
    expect(c.raycast(road[0], road[1], ver[0], ver[1])).not.toBeNull();
    // Le fût du totem arrête ; on passe sous la poutre du portique, entre ses poteaux.
    const [ts, tt] = m.site!.totem, t0 = at(f, ts - 1, tt), t1 = at(f, ts + 1, tt);
    expect(c.raycast(t0[0], t0[1], t1[0], t1[1])).not.toBeNull();
    const [g0, g1, gt] = m.site!.gantry, gm = (g0 + g1) / 2, p0 = at(f, gm, gt - 2), p1 = at(f, gm, gt + 2);
    expect(c.raycast(p0[0], p0[1], p1[0], p1[1])).toBeNull();
  });

  it("géométrie : sommets finis, près des volumes, coût borné, sous le haut du totem ; inscriptions (D235)", () => {
    const texts: string[] = [];
    const s = sinks(texts);
    buildMcdo(s, m, world.terrain);
    expect(texts).toEqual(["McDonald's", "2.75", "DRIVE →", "McDRIVE", "PARKING"]);
    const p = s.solid.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    const tris = p.length / 9;
    expect(tris).toBeGreaterThan(800);
    expect(tris).toBeLessThan(12000);
    expect(s.glow.positions.length).toBeGreaterThan(0);
    // Les obstacles, et les toiles des parasols (1,8 m autour de leur mât).
    const fr = mcdoFrame(m);
    const pts = [...mcdoRings(m).flat(), ...(m.site!.parasols ?? []).flatMap(([s, t]) => [...at(fr, s - 1.8, t - 1.8), ...at(fr, s + 1.8, t + 1.8), ...at(fr, s - 1.8, t + 1.8), ...at(fr, s + 1.8, t - 1.8)])];
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    const bb = bounds(p);
    expect(bb.x0).toBeGreaterThan(Math.min(...xs) - 1);
    expect(bb.x1).toBeLessThan(Math.max(...xs) + 1);
    expect(bb.y0).toBeGreaterThan(Math.min(...ys) - 1);
    expect(bb.y1).toBeLessThan(Math.max(...ys) + 1);
    // Le plus haut : le caisson du totem, 8 m au-dessus de son pied.
    expect(bb.z1).toBeLessThan(world.terrain.heightAt(...at(mcdoFrame(m), ...m.site!.totem)) + 8.1);
    expect(bb.z1).toBeGreaterThan(m.crest);
  });
});

describe("bowling Strike Bowl de la route de Chalon (D234, D235)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[BOWL]!;
  const m = kind.bowl!;
  const b = world.tile.buildings.find((q) => q.id === BOWL)!;

  it("volumes mesurés plausibles (photos et relevé)", () => {
    expect(m).toBeDefined();
    // Halle d'environ 17 × 28 m, égout vers 5,3 m, faîtage vers 7,5 m ; ailes basses (moins de 5 m) plus basses que l'égout de la halle.
    expect(m.w).toBeGreaterThan(15);
    expect(m.w).toBeLessThan(19);
    expect(m.l).toBeGreaterThan(26);
    expect(m.l).toBeLessThan(30);
    expect(m.eave - m.g).toBeGreaterThan(4.5);
    expect(m.ridge - m.g).toBeGreaterThan(6.8);
    expect(m.ridge - m.g).toBeLessThan(8.5);
    expect(m.wing.length).toBe(2);
    for (const q of [...bowlingBlocks(m), ...m.pergola]) {
      expect(q[5]).toBeLessThan(m.eave);
      expect(q[5] - m.g).toBeGreaterThan(2.2);
      expect(q[1] - q[0]).toBeGreaterThan(2);
      expect(q[3] - q[2]).toBeGreaterThan(5);
    }
    // L'aile ouest est à l'ouest de la halle, l'aile est et la pergola à l'est ; la pergola au sud (côté route).
    for (const q of m.wing) expect(q[1]).toBeLessThanOrEqual(0.01);
    for (const q of [...m.east, ...m.low, ...m.pergola]) expect(q[0]).toBeGreaterThanOrEqual(m.w - 0.01);
    for (const q of m.pergola) expect(q[2]).toBeLessThan(0);
    expect(drawsGenericRoof(kind)).toBe(false);
    expect(walkableRoof(kind)).toBe(false);
    expect(replacesFacade(kind)).toBe(true);
    // La boîte BD TOPO collée à l'aile ouest est masquée.
    expect(isOpen(world.tile.kinds, HIDDEN)).toBe(true);
    const f = bowlingFrame(m);
    expect(pointInRing(...at(f, m.w / 2, m.l / 2), b.ring)).toBe(true);
  });

  it("obstacles : la halle et les ailes ; on passe sous l'auvent du pignon et sous la pergola", () => {
    const rings = bowlingRings(m);
    const f = bowlingFrame(m);
    const c = buildColliders({ ...world.tile, buildings: [b] });
    // Depuis la route, on bute sur le mur vitré en retrait du pignon sud, après être passé sous l'auvent.
    const road = at(f, m.w / 2, -10), hall = at(f, m.w / 2, m.l / 2);
    const hit = c.raycast(road[0], road[1], hall[0], hall[1]);
    expect(hit).not.toBeNull();
    const [, , t0] = bowlingHallWalls(m);
    expect(t0).toBeGreaterThan(1);
    const under = at(f, m.w / 2, t0 / 2), front = at(f, m.w / 2, -3);
    expect(c.raycast(front[0], front[1], under[0], under[1])).toBeNull();
    // Dans l'aile ouest, on n'entre pas depuis le parking.
    const [s0, s1, , t1] = m.wing[1]!;
    const park = at(f, (s0 + s1) / 2, t1 + 8), wing = at(f, (s0 + s1) / 2, t1 - 3);
    expect(c.raycast(park[0], park[1], wing[0], wing[1])).not.toBeNull();
    // Sous la pergola, entre ses poteaux.
    const [p0, p1, q0, q1] = m.pergola[0]!;
    const a = at(f, (p0 + p1) / 2 + 1.7, q0 - 2), z = at(f, (p0 + p1) / 2 + 1.7, (q0 + q1) / 2);
    expect(c.raycast(a[0], a[1], z[0], z[1])).toBeNull();
    expect(rings.length).toBeGreaterThan(5);
  });

  it("géométrie : sommets finis, près des volumes, coût borné, sous le faîtage ; enseignes (D235)", () => {
    const texts: string[] = [];
    const s = sinks(texts);
    buildBowling(s, m, world.terrain);
    // Deux logos ronds (pignon ouest de l'aile, pignon de la route), la peinture, le bandeau, les deux plaques des portes du parking.
    expect(texts.filter((t) => t === "STRIKE").length).toBe(2);
    expect(texts).toContain("BOWLING · BAR · CAVE À BIÈRE");
    expect(texts).toContain("BIÈRE");
    expect(texts).toContain("bowling");
    expect(texts).toContain("bar restaurant");
    expect(texts).toContain("BOWLING ←");
    expect(texts.length).toBe(2 * 4 + 2 + 1 + 2 + 2);
    const p = s.solid.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    const tris = p.length / 9;
    expect(tris).toBeGreaterThan(600);
    expect(tris).toBeLessThan(16000);
    expect(s.glow.positions.length).toBeGreaterThan(0);
    const f = bowlingFrame(m);
    const pts = [...bowlingRings(m).flat(), ...m.pergola.flatMap(([a0, a1, b0, b1]) => [...at(f, a0, b0), ...at(f, a1, b1)]), ...at(f, 0, 0), ...at(f, m.w, m.l),
      ...roadsideLines({ bowl: m }).flatMap((l) => l.pts)];
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    const bb = bounds(p);
    expect(bb.x0).toBeGreaterThan(Math.min(...xs) - 1);
    expect(bb.x1).toBeLessThan(Math.max(...xs) + 1);
    expect(bb.y0).toBeGreaterThan(Math.min(...ys) - 1);
    expect(bb.y1).toBeLessThan(Math.max(...ys) + 1);
    expect(bb.z1).toBeLessThan(m.ridge + 0.3);
  });
});
