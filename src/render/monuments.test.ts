import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import { MeshBuilder } from "./geometry";
import { buildCathedral, buildFarTower, buildGate } from "./monuments";

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
});
