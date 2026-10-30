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
    // Portique et perron (D125) : palier au niveau du haut du soubassement, volée devant le portique, aussi large que l'avant-corps central ;
    // les marches (droite du palier au pied) restent au-dessus du relief, qui est la surface où l'on marche.
    const [tf, zTop] = m.portico!;
    const [ps0, ps1, tl, tfoot, zl] = m.perron!;
    expect(Math.abs(zl - (m.g + m.levels[0]))).toBeLessThan(0.6);
    expect(zTop - m.g).toBeGreaterThan(m.levels[1]);
    expect(tl).toBeLessThan(tf);
    expect(tfoot).toBeLessThan(tl - 5);
    expect(ps1 - ps0).toBeGreaterThan(0.8 * (m.pav[1]![1] - m.pav[1]![0]));
    const f = { c: Math.cos(m.a), s: Math.sin(m.a) };
    const xy = (s: number, t: number): [number, number] => [m.o[0] + f.c * s - f.s * t, m.o[1] + f.s * s + f.c * t];
    const zFoot = world.terrain.heightAt(...xy((ps0 + ps1) / 2, tfoot));
    for (let t = tfoot + 0.5; t < tl; t += 0.5) {
      for (const s of [ps0 + 0.5, (ps0 + ps1) / 2, ps1 - 0.5]) {
        const line = zFoot + ((t - tfoot) / (tl - tfoot)) * (zl - zFoot);
        expect(world.terrain.heightAt(...xy(s, t))).toBeLessThan(line + 0.2);
      }
    }
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildTownHall(mb, glow, m, world.terrain, new THREE.Color("#2f4a63"));
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeGreaterThan(500);
    expect(tris(mb)).toBeLessThan(6000);
    expect(tris(glow)).toBeGreaterThan(0);
  });
});
