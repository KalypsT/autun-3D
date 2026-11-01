import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/types";
import { GATE_LAYOUT, SCHOOL_GATE, gateFrame } from "../core/school-gate";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildGateLeaves, buildGatePosts } from "./vallon-gate";

/** D174 : entrée du collège du Vallon, partie dessinée (lot 3 de docs/plans/college-vallon.md). */
const GROUND = -34.6;
const flat: HeightField = { heightAt: () => GROUND, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
const labels: string[] = [];
const atlas = { get: (text: string) => { labels.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas });

describe("Entrée du collège (D174) : partie fixe", () => {
  it("poteaux, pilier, panneau et lampadaires : maillage fini, le panneau porte « Collège le Vallon », moins de 1 000 triangles", () => {
    const s = sinks();
    buildGatePosts(s, SCHOOL_GATE, flat);
    expect(s.solid.triangleCount).toBeGreaterThan(60);
    expect(s.solid.triangleCount).toBeLessThan(1000);
    expect(s.solid.positions.every(Number.isFinite)).toBe(true);
    expect(labels).toContain("Collège le Vallon");
    expect(s.glow.positions.length).toBeGreaterThan(0);
  });

  it("rien n'est plus haut que les lampadaires (5,6 m) ni, sauf eux, que le pilier et le panneau", () => {
    const s = sinks();
    buildGatePosts(s, SCHOOL_GATE, flat);
    const top = Math.max(...s.solid.positions.filter((_, i) => i % 3 === 1));
    expect(top).toBeLessThan(GROUND + 5.7);
    expect(top).toBeGreaterThan(GROUND + 5.4);
  });
});

describe("Entrée du collège (D174) : vantaux fermés", () => {
  it("le maillage des vantaux est fini, de moins de 1 500 triangles, et reste dans l'emprise de la grille, à 2,2 m du sol au plus", () => {
    const g = buildGateLeaves(SCHOOL_GATE, flat);
    const pos = g.getAttribute("position");
    expect(pos.count).toBeGreaterThan(300);
    expect(pos.count / 3).toBeLessThan(1500);
    const f = gateFrame();
    let max = -1e9, min = 1e9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = -pos.getZ(i), z = pos.getY(i);
      expect(Number.isFinite(x + y + z)).toBe(true);
      const s = (x - SCHOOL_GATE.o[0]) * f.u[0] + (y - SCHOOL_GATE.o[1]) * f.u[1];
      const t = (x - SCHOOL_GATE.o[0]) * SCHOOL_GATE.n[0] + (y - SCHOOL_GATE.o[1]) * SCHOOL_GATE.n[1];
      expect(s).toBeGreaterThan(GATE_LAYOUT.leaf[0] - 0.1);
      expect(s).toBeLessThan(GATE_LAYOUT.wicket[1] + 0.1);
      expect(Math.abs(t)).toBeLessThan(0.3);
      max = Math.max(max, z);
      min = Math.min(min, z);
    }
    expect(max - GROUND).toBeLessThan(2.2);
    expect(min - GROUND).toBeGreaterThan(-0.2);
  });
});
