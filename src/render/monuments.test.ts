import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import { MeshBuilder } from "./geometry";
import { buildCathedral, buildFarTower, buildGate, buildTownHall } from "./monuments";

describe("monuments (D95) : géométrie", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;

  it("portes et cathédrale : sommets finis, coût en triangles borné", () => {
    for (const s of kinds.sites) {
      if (s.t !== "gate") continue;
      const mb = new MeshBuilder();
      buildGate(mb, s, world.terrain);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      expect(tris(mb)).toBeLessThan(3000);
    }
    const k = Object.values(kinds.buildings).find((b) => b.mon)!;
    const mb = new MeshBuilder();
    buildCathedral(mb, k.mon!, world.terrain, new THREE.Color("#405060"));
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeLessThan(2000);
    const far = new MeshBuilder();
    buildFarTower(far, k.tower!, world.terrain);
    expect(tris(far)).toBeLessThan(100);
  });

  it("hôtel de ville (D123) : mesures plausibles, sommets finis, coût borné", () => {
    const m = Object.values(kinds.buildings).find((b) => b.hall)!.hall!;
    // Hauteurs au-dessus de la place : corniche ≈ 17 m, faîtage ≈ 22,5 m, pavillons d'angle ≈ 25 m, pavillon central ≈ 28 m, ailes plus basses.
    expect(m.eave - m.g).toBeGreaterThan(15);
    expect(m.eave - m.g).toBeLessThan(19);
    expect(m.ridge).toBeGreaterThan(m.eave + 3);
    expect(m.pav).toHaveLength(3);
    const [left, centre, right] = m.pav.map((p) => p[6]);
    expect(centre!).toBeGreaterThan(left! + 2);
    expect(centre!).toBeGreaterThan(right! + 2);
    expect(Math.min(left!, right!)).toBeGreaterThan(m.ridge);
    expect(m.wingEave).toBeLessThan(m.eave);
    expect(m.wingRidge).toBeLessThan(m.ridge);
    // Chaque plateau tient dans la base de son pavillon.
    for (const [s0, s1, ps0, ps1, pt0, pt1] of m.pav) {
      expect(ps0).toBeGreaterThanOrEqual(s0);
      expect(ps1).toBeLessThanOrEqual(s1);
      expect(pt0).toBeGreaterThan(0);
      expect(pt1).toBeLessThan(m.d);
    }
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildTownHall(mb, glow, m, world.terrain, new THREE.Color("#2f4a63"));
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeGreaterThan(500);
    expect(tris(mb)).toBeLessThan(6000);
    expect(tris(glow)).toBeGreaterThan(0);
  });
});
