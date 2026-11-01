import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flatTerrain } from "../core/testing";
import type { FacadeFiche, TileData } from "../data/types";
import { MeshBuilder } from "./geometry";
import { styledTerrace, type Front } from "./shopfront";

/** D157 : les cafés de la rue du Champ de Mars ont leur vitrine et leur terrasse sur la place (build_shop_fronts.py, `shopWalls`). */
describe("cafés de la rue du Champ de Mars (D157)", () => {
  const tile = JSON.parse(readFileSync("public/data/tiles/25_35.json", "utf8")) as TileData;
  const fiche = (id: string): FacadeFiche => tile.fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
  /** Cap (degrés depuis le nord) de la normale sortante du mur `k` de la fiche. */
  const facing = (id: string, k: number): number => {
    const b = tile.buildings.find((q) => q.id === `BATIMENT0000000${id}`)!;
    const f = fiche(id);
    const n = b.ring.length / 2, w = f.walls[k]!;
    const x1 = b.ring[2 * w.a]!, y1 = b.ring[2 * w.a + 1]!, x2 = b.ring[2 * ((w.a + 1) % n)]!, y2 = b.ring[2 * ((w.a + 1) % n) + 1]!;
    let area = 0;
    for (let i = 0; i < n; i++) area += b.ring[2 * i]! * b.ring[2 * ((i + 1) % n) + 1]! - b.ring[2 * ((i + 1) % n)]! * b.ring[2 * i + 1]!;
    const s = area > 0 ? 1 : -1;
    return ((Math.atan2(s * (y2 - y1), s * -(x2 - x1)) * 180) / Math.PI + 360) % 360;
  };

  it("L'Augusto et Havas Voyages sont sur le mur qui regarde la rue du Champ de Mars (sud-est), plus sur le mur arrière", () => {
    const a = fiche("348854061"), h = fiche("348854060");
    const aug = a.ground.shops!.find((s) => s.name === "L'Augusto")!;
    expect(a.ground.front).toBe(0);
    expect(aug.wall).toBe(0);
    expect(a.walls[0]!.role).toBe("street");
    expect(Math.abs(((facing("348854061", 0) - 136 + 540) % 360) - 180)).toBeLessThan(6);
    expect(a.ground.shops!.some((s) => s.name === "Havas Voyages")).toBe(false);
    const hav = h.ground.shops!.find((s) => s.name === "Havas Voyages")!;
    expect(hav.wall).toBe(3);
    expect(h.walls[3]!.role).toBe("street");
    expect(Math.abs(((facing("348854060", 3) - 136 + 540) % 360) - 180)).toBeLessThan(6);
  });

  it("les terrasses lues sur photo sont dans les fiches : estrade et tonneaux (L'Augusto), panneaux gris (Le Central)", () => {
    const aug = fiche("348854061").ground.shops!.find((s) => s.name === "L'Augusto")!;
    expect(aug.terrace).toMatchObject({ platform: "#d9d3c6", planters: "barrel" });
    const cen = fiche("348853814").ground.shops!.find((s) => s.name === "Le Central")!;
    expect(cen.terrace?.screen).toBe("#4b5256");
    expect(fiche("348854064").ground.shops![0]!.terrace?.awning).toBe("#a8242c");
  });

  const front: Front = { x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: 1, width: 8, zTop: 3, zSign: 3.4, key: "t" };
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;

  it("estrade à tonneaux : sommets finis, coût borné ; sol non libre : on retombe sur la terrasse générique", () => {
    const mb = new MeshBuilder();
    expect(styledTerrace(mb, front, flatTerrain(), () => true, { platform: "#d9d3c6", planters: "barrel", parasol: "#7d1d2a", depth: 2.8 })).toBe(true);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeGreaterThan(100);
    expect(tris(mb)).toBeLessThan(900);
    const none = new MeshBuilder();
    expect(styledTerrace(none, front, flatTerrain(), () => false, { platform: "#d9d3c6" })).toBe(false);
    expect(tris(none)).toBe(0);
  });

  it("panneaux ajourés : un panneau le long du bord extérieur", () => {
    const mb = new MeshBuilder();
    expect(styledTerrace(mb, front, flatTerrain(), () => true, { screen: "#4b5256", depth: 2.4 })).toBe(true);
    expect(tris(mb)).toBeGreaterThan(60);
    expect(tris(mb)).toBeLessThan(900);
  });
});
