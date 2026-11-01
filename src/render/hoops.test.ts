import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HeightField, Site, TileKinds } from "../data/types";
import { HOOP, hoopDir, hoopPole } from "../core/hoops";
import { landmarkCircles } from "../core/landmarks";
import { MeshBuilder } from "./geometry";
import { buildHoops } from "./hoops";
import { pitchPolys } from "./landmarks";

/** D176 : terrains du collège du Vallon, lot 5 de docs/plans/college-vallon.md (revêtement lu à l'orthophotographie, paniers de basket). */
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
type Pitch = Extract<Site, { t: "pitch" }>;
const pitches = kinds.sites.filter((s): s is Pitch => s.t === "pitch");
const hoops = pitches.flatMap((p) => p.hoops ?? []);
const flat: HeightField = { heightAt: () => -34, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };

describe("Terrains du collège (D176) : données", () => {
  it("trois plateaux, tous en enrobé gris : plus de sol rouge ni bleu", () => {
    expect(pitches).toHaveLength(3);
    for (const p of pitches) {
      expect(p.surf, `${p.box}`).toBeDefined();
      for (const hex of [p.surf!, p.court!]) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), hex).toBeLessThan(16);
        expect(r!).toBeLessThan(0x90);
      }
    }
    const { surface } = pitchPolys(pitches[2]!);
    expect(surface[0]![1]).toBe(pitches[2]!.surf);
  });

  it("cinq paniers, chacun au bord de son plateau et tourné vers lui", () => {
    expect(hoops).toHaveLength(5);
    for (const p of pitches) {
      const [cx, cy] = p.box;
      for (const h of p.hoops ?? []) {
        const [dx, dy] = hoopDir(h[2]);
        // Regarder vers le centre : le produit scalaire de la direction et du vecteur panneau → centre est positif.
        expect(dx * (cx - h[0]) + dy * (cy - h[1]), `panier (${h})`).toBeGreaterThan(0);
        expect(Math.hypot(cx - h[0], cy - h[1])).toBeLessThan(26);
      }
    }
  });

  it("le poteau est à 1,2 m derrière le panneau, et c'est un obstacle de la tuile", () => {
    const h = hoops[0]!;
    const [px, py] = hoopPole(h);
    expect(Math.hypot(px - h[0], py - h[1])).toBeCloseTo(HOOP.arm, 9);
    const circles = landmarkCircles(kinds, []);
    for (const q of hoops) {
      const [x, y] = hoopPole(q);
      expect(circles.some(([cx, cy, r]) => Math.hypot(cx - x, cy - y) < 0.01 && r === HOOP.poleRadius)).toBe(true);
    }
  });
});

describe("Terrains du collège (D176) : maillage des paniers", () => {
  it("un panier : maillage fini, panneau à 2,9 m, anneau à 3,05 m, rien au-dessus du panneau et du poteau", () => {
    const mb = new MeshBuilder();
    buildHoops(mb, [hoops[0]!], flat);
    expect(mb.triangleCount).toBeGreaterThan(30);
    expect(mb.triangleCount).toBeLessThan(150);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    const ys = mb.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(-34 + HOOP.boardTop, 6);
    expect(ys.some((y) => Math.abs(y - (-34 + HOOP.rim)) < 1e-6)).toBe(true);
  });

  it("les cinq paniers font moins de 600 triangles", () => {
    const mb = new MeshBuilder();
    buildHoops(mb, hoops, flat);
    expect(mb.triangleCount).toBeLessThan(600);
  });
});
