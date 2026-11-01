import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D179 : boutiques d'angle génériques (vitrine du même commerce sur le mur voisin) et Le Commerce d'après photo. */
const TILES = ["24_37", "25_35", "25_38", "26_32", "26_33", "26_34", "26_37", "33_36", "34_34"];
const fiches: FacadeFiche[] = TILES.flatMap((id) => (JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData).fiches);

describe("boutiques d'angle génériques (D179)", () => {
  const wrapped = fiches.flatMap((f) => (f.ground.shops ?? []).filter((s) => s.corner).map((s) => ({ f, s })));

  it("il y en a une dizaine, toutes nommées, hors devantures d'après photo", () => {
    expect(wrapped.length).toBeGreaterThanOrEqual(10);
    for (const { f, s } of wrapped) {
      expect(s.name).toBeTruthy();
      expect(f.ground.devanture).toBeUndefined();
    }
  });

  it("la vitrine d'angle est sur un mur de rue voisin (sommet commun), assez long, et son milieu est à 3 m du coin", () => {
    for (const { f, s } of wrapped) {
      const own = f.walls[s.wall]!, adj = f.walls[s.corner!.wall]!;
      expect(s.corner!.wall, s.name ?? "").not.toBe(s.wall);
      expect(adj.role).toBe("street");
      expect(adj.length).toBeGreaterThanOrEqual(5.5);
      expect(own.a === adj.b || own.b === adj.a, s.name ?? "").toBe(true);
      // Le milieu est à 3,2 m du coin : au début du mur voisin s'il le suit, à sa fin s'il le précède.
      const atStart = own.b === adj.a;
      expect(s.corner!.s).toBeCloseTo(atStart ? 3.2 : adj.length - 3.2, 1);
    }
  });

  it("deux vitrines d'angle d'une même fiche ne se chevauchent pas, ni avec un commerce du mur voisin", () => {
    for (const f of fiches) {
      const pos: [number, number][] = (f.ground.shops ?? []).map((s) => [s.wall, s.s]);
      for (const s of f.ground.shops ?? []) if (s.corner) pos.push([s.corner.wall, s.corner.s]);
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          if (pos[i]![0] === pos[j]![0]) expect(Math.abs(pos[i]![1] - pos[j]![1]), f.id).toBeGreaterThan(0.5);
        }
      }
    }
  });
});

describe("Le Commerce, façade sur la place (D179)", () => {
  const f = fiches.find((x) => x.id === "BATIMENT0000000348854064")!;
  it("brasserie : devanture d'angle sur le mur 0 (7 m, en rue), store lettré, façade de l'avenue inchangée", () => {
    expect(f.ground.front).toBe(1);
    expect(f.ground.devanture).toBeUndefined();
    const c = f.ground.corner!;
    expect(c.wall).toBe(0);
    expect(f.walls[0]!.role).toBe("street");
    const width = c.devanture.bays.reduce((a, q) => a + q[1], 0);
    expect(c.devanture.s0 + width).toBeLessThanOrEqual(f.walls[0]!.length + 0.01);
    expect(c.devanture.awning!.text).toContain("LE COMMERCE");
    expect(f.ground.shops![0]!.terrace).toBeDefined();
    const mb = new MeshBuilder();
    buildDevanture(mb, null, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, c.devanture, f.ground.shopfront!.color);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(mb.positions.length / 9).toBeLessThan(2500);
  });
});
