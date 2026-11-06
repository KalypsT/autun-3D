import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HeightField, RampartTower, TileData, Wall } from "../data/types";
import { Colliders } from "../core/collision";
import { isProfiled, towerArc, towerOutline } from "../core/ramparts";
import { addTileColliders } from "../core/world";
import { MeshBuilder } from "./geometry";
import { buildRampart, buildTowers } from "./ramparts";

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

describe("Remparts, lot 3 (D254) : les tours", () => {
  const towers: { tile: string; t: RampartTower }[] = [];
  for (const f of readdirSync("public/data/tiles").filter((n) => n.endsWith(".json"))) {
    const t = JSON.parse(readFileSync(`public/data/tiles/${f}`, "utf8")) as TileData;
    for (const q of t.towers ?? []) towers.push({ tile: f.replace(".json", ""), t: q });
  }
  const urs = towers.find(({ t }) => t.k === "ursulines")!;

  it("treize tours : la tour des Ursulines et douze tours rondes (Résistants Fusillés, Mac Mahon, Laureau)", () => {
    expect(towers).toHaveLength(13);
    expect(towers.filter(({ t }) => t.k === "round")).toHaveLength(12);
    for (const { t } of towers.filter(({ t }) => t.k === "round")) {
      expect(t.r!).toBeGreaterThanOrEqual(3);
      expect(t.r!).toBeLessThanOrEqual(4.5);
      expect(t.top!).toBeGreaterThan(t.base + 3);
    }
  });

  it("tour des Ursulines : octogone de 5 à 6 m d'apothème, près de 30 m de maçonnerie côté boulevard, statue au-dessus ; la maison BD TOPO masquée", () => {
    const t = urs.t;
    expect(Math.hypot(t.x - 9.1, t.y + 950.9)).toBeLessThan(2);
    expect(t.apo!).toBeGreaterThan(5);
    expect(t.apo!).toBeLessThan(6);
    expect(t.deck! - t.base).toBeGreaterThan(27);
    expect(t.deck! - t.base).toBeLessThan(32);
    expect(t.statue!).toBeGreaterThan(t.roof!);
    const kinds = JSON.parse(readFileSync(`public/data/kinds/${urs.tile}.json`, "utf8")) as { buildings: Record<string, { k: string }> };
    expect(kinds.buildings["BATIMENT0000000348856003"]?.k).toBe("hidden");
  });

  it("arc d'une tour ronde : devant la face du mur, contour fermé ; dessin fini et sobre (2 500 triangles au plus par tour ronde, 8 000 pour les Ursulines, comme Couhard)", () => {
    for (const { t } of towers) {
      if (t.k === "round") {
        const { pts } = towerArc(t);
        for (let i = 0; i < pts.length; i += 2) expect((pts[i]! - t.fx!) * t.nx! + (pts[i + 1]! - t.fy!) * t.ny!).toBeGreaterThan(-0.3);
      }
      const o = towerOutline(t);
      expect(o[0]).toBe(o[o.length - 2]);
      const mb = new MeshBuilder();
      const flat: HeightField = { heightAt: () => t.base, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
      buildTowers({ solid: mb, cap: mb, hedgeColor: new THREE.Color("#5aa874") }, [t], flat);
      expect(mb.positions.every(Number.isFinite), String(t.id)).toBe(true);
      expect(mb.positions.length / 9).toBeLessThan(t.k === "ursulines" ? 8000 : 2500);
    }
  });

  it("collisions : le pied d'une tour arrête le joueur", () => {
    const { tile, t } = towers.find(({ t }) => t.k === "round")!;
    const data = JSON.parse(readFileSync(`public/data/tiles/${tile}.json`, "utf8")) as TileData;
    const c = new Colliders();
    addTileColliders(c, { buildings: [], walls: [], furniture: [], trees: [], towers: data.towers });
    // Juste devant le sommet de l'arc, en dehors : repoussé.
    const ax = t.x + t.nx! * (t.r! + 0.1), ay = t.y + t.ny! * (t.r! + 0.1);
    const r = c.resolve(ax, ay, 0.3);
    expect(Math.hypot(r.x - ax, r.y - ay)).toBeGreaterThan(0.1);
  });
});
