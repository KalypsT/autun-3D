import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREAKABLE, CAR_ONLY } from "../core/breakables";
import { buildColliders } from "../core/world";
import { MeshBuilder } from "../render/geometry";
import { buildFurniture } from "../render/props";
import { flatTerrain } from "../core/testing";
import type { Furniture, TileData, TileSigns } from "./types";

/** D295 : panneaux tirés du graphe routier (tools/data/build_signs.py). */
const KINDS = ["sign_stop", "sign_give_way", "sign_no_entry", "sign_speed"];
const index = JSON.parse(readFileSync("public/data/signs/index.json", "utf8")) as { tiles: string[] };
const files = readdirSync("public/data/signs").filter((f) => f !== "index.json");
const byTile = new Map(index.tiles.map((t) => [t, (JSON.parse(readFileSync(`public/data/signs/${t}.json`, "utf8")) as TileSigns).items]));
const all = [...byTile.values()].flat();

function inside(x: number, y: number, r: readonly number[]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

describe("panneaux de signalisation (D295)", () => {
  it("un fichier par tuile listée, des natures connues, des identifiants uniques, des vitesses réglementaires", () => {
    expect(files.sort()).toEqual(index.tiles.map((t) => `${t}.json`).sort());
    expect(all.length).toBeGreaterThan(300);
    for (const k of KINDS) expect(all.filter((f) => f.kind === k).length).toBeGreaterThan(15);
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
    for (const f of all) {
      expect(KINDS).toContain(f.kind);
      expect(f.id).toBeLessThan(-960_000_000);
      expect(Number.isFinite(f.rot)).toBe(true);
      if (f.kind === "sign_speed") expect([20, 30, 40, 50, 70, 80, 90, 110]).toContain(Number(f.name));
      else expect(f.name).toBeNull();
    }
  });

  it("chaque panneau est dans sa tuile, hors des bâtiments et de la chaussée dessinée", () => {
    for (const [id, items] of byTile) {
      const t = JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData;
      const [x0, y0, x1, y1] = t.bounds;
      const roads = Object.entries(t.ground).filter(([k]) => k.startsWith("road_")).flatMap(([, p]) => p);
      for (const f of items) {
        expect(f.x >= x0 && f.x < x1 && f.y >= y0 && f.y < y1).toBe(true);
        expect(t.buildings.some((b) => inside(f.x, f.y, b.ring))).toBe(false);
        expect(roads.some((p) => inside(f.x, f.y, p[0]!) && !p.slice(1).some((h) => inside(f.x, f.y, h)))).toBe(false);
      }
    }
  });

  it("arrachés par les voitures du joueur, traversables pour les passants et la circulation", () => {
    for (const k of KINDS) {
      expect(BREAKABLE[k]).toBeDefined();
      expect(CAR_ONLY.has(k)).toBe(true);
    }
    const f: Furniture = { kind: "sign_stop", x: 0, y: 0, name: null, id: -960_000_001, rot: 0 };
    const c = buildColliders({ buildings: [], walls: [], furniture: [f], trees: [] });
    expect(c.resolve(0, 0, 0.3, 0).hit).toBe(false);
  });

  it("dessin : chaque nature dessine sa plaque (chiffres compris), sommets finis, coût borné", () => {
    const counts = KINDS.map((kind) => {
      const mb = new MeshBuilder();
      buildFurniture(mb, [{ kind, x: 0, y: 0, name: kind === "sign_speed" ? "30" : null, id: -1, rot: 0.5 }], flatTerrain());
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      return mb.positions.length / 9;
    });
    for (const n of counts) {
      expect(n).toBeGreaterThan(15);
      expect(n).toBeLessThan(120);
    }
    // La limitation porte ses chiffres : plus de triangles que le sens interdit.
    expect(counts[3]!).toBeGreaterThan(counts[2]!);
  });
});
