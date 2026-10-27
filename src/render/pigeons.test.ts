import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PigeonState } from "../core/pigeons";
import { PIGEON_SCALE, PIGEON_TRIS, PIGEON_VERTS, PigeonRenderer } from "./pigeons";

function state(n: number): PigeonState {
  const f = (): Float32Array => new Float32Array(n);
  return { capacity: n, alive: new Uint8Array(n).fill(1), x: f(), y: f(), z: f(), heading: f(), pitch: f(), wing: f(), wing2: f(), fold: f(), peck: f(), bob: f(), tint: new Uint8Array(n) };
}

describe("rendu des pigeons", () => {
  it("garde un budget de triangles raisonnable et des indices valides", () => {
    expect(PIGEON_TRIS).toBeLessThan(400);
    expect(PIGEON_VERTS).toBeLessThan(250);
    expect(40 * PIGEON_VERTS).toBeLessThan(65536);
  });

  it("pose chaque oiseau sans valeur absurde : au sol, les pieds touchent le sol et la tête reste sous 40 cm ; en vol, l'envergure reste sous 80 cm", () => {
    const scene = new THREE.Scene();
    const r = new PigeonRenderer(scene, 8);
    const s = state(8);
    for (let i = 0; i < 8; i++) {
      s.x[i] = i; s.y[i] = 2; s.z[i] = 10; s.heading[i] = i * 0.7; s.tint[i] = i % 4;
      if (i >= 4) { s.fold[i] = 1; s.wing[i] = Math.sin(i) * 0.9; s.wing2[i] = Math.cos(i) * 0.5; s.pitch[i] = 0.3; }
      else s.peck[i] = i / 3;
    }
    r.update(s);
    expect(r.drawn).toBe(8);
    const pos = r.mesh.geometry.getAttribute("position").array as Float32Array;
    for (let i = 0; i < 8; i++) {
      let lo = Infinity, hi = -Infinity, wide = 0;
      for (let j = 0; j < PIGEON_VERTS; j++) {
        const o = (i * PIGEON_VERTS + j) * 3;
        expect(Number.isFinite(pos[o]! + pos[o + 1]! + pos[o + 2]!)).toBe(true);
        lo = Math.min(lo, pos[o + 1]!);
        hi = Math.max(hi, pos[o + 1]!);
        wide = Math.max(wide, Math.hypot(pos[o]! - i, pos[o + 2]! + 2));
      }
      if (i < 4) {
        expect(lo).toBeGreaterThanOrEqual(10 - 0.02);
        expect(hi).toBeLessThan(10 + 0.4);
      }
      expect(wide).toBeLessThan(0.8 * PIGEON_SCALE);
    }
    r.dispose();
  });

  it("ne dessine que les oiseaux vivants et se vide sans oiseau", () => {
    const scene = new THREE.Scene();
    const r = new PigeonRenderer(scene, 4);
    const s = state(4);
    s.alive[1] = 0;
    r.update(s);
    expect(r.drawn).toBe(3);
    expect(r.mesh.visible).toBe(true);
    s.alive.fill(0);
    r.update(s);
    expect(r.drawn).toBe(0);
    expect(r.mesh.visible).toBe(false);
    r.dispose();
  });
});
