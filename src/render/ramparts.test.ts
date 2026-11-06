import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HeightField, TileData, Wall } from "../data/types";
import { isProfiled } from "../core/ramparts";
import { MeshBuilder } from "./geometry";
import { buildRampart } from "./ramparts";

const walls: { tile: string; w: Wall }[] = [];
for (const f of readdirSync("public/data/tiles").filter((n) => n.endsWith(".json"))) {
  const t = JSON.parse(readFileSync(`public/data/tiles/${f}`, "utf8")) as TileData;
  for (const w of t.walls) if (w.kind === "rampart") walls.push({ tile: f.replace(".json", ""), w });
}
const lookAt = (x: number, y: number): string | undefined =>
  walls.find(({ w }) => {
    for (let i = 0; i < w.pts.length; i += 2) if (Math.hypot(w.pts[i]! - x, w.pts[i + 1]! - y) < 6) return true;
    return false;
  })?.w.look;
const length = (w: Wall): number => {
  let s = 0;
  for (let i = 0; i + 3 < w.pts.length; i += 2) s += Math.hypot(w.pts[i + 2]! - w.pts[i]!, w.pts[i + 3]! - w.pts[i + 1]!);
  return s;
};

describe("Remparts, lot 2 (D253) : l'aspect", () => {
  it("chaque rempart a un aspect ; ceux des photos ont le leur", () => {
    for (const { w } of walls) expect(["rubble", "restored", "bright", "schist", "garden"]).toContain(w.look);
    expect(lookAt(-146.6, -402)).toBe("rubble"); // boulevard des Résistants Fusillés, photos 1 à 3
    expect(lookAt(940, 175)).toBe("restored"); // rue de la Maladière, photo 7
    expect(lookAt(167.7, 544.7)).toBe("bright"); // boulevard Laureau, photos 11 et 12
    expect(lookAt(369.2, -494.3)).toBe("schist"); // rue du Vieux Colombier, photos 9 et 10
    expect(lookAt(600, -253.4)).toBe("garden"); // rue Gaston Joliet, photos 13 et 14
  });

  it("dessin : sommets finis, au plus 150 triangles par mètre de mur (soit 500 000 pour toute l'enceinte au pire, moins de 1 sur 10 à l'écran)", () => {
    // Relief plat, au plus bas des sols mesurés : les faces descendent jusqu'en bas (le cas le plus coûteux).
    let tris = 0, meters = 0;
    for (const { w } of walls) {
      if (!isProfiled(w)) continue;
      const low = Math.min(...w.gl, ...w.gr);
      const flat: HeightField = { heightAt: () => low, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
      const mb = new MeshBuilder();
      buildRampart({ solid: mb, cap: mb, hedgeColor: new THREE.Color("#5aa874") }, w, flat);
      expect(mb.positions.every(Number.isFinite), String(w.id)).toBe(true);
      tris += mb.positions.length / 9;
      meters += length(w);
    }
    expect(tris / meters).toBeLessThan(150);
  });
});
