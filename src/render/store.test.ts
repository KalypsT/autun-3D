import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildStore, lidlCartShelter } from "./store";

const LIDL = "BATIMENT0000000348858792", PHARMACY = "BATIMENT0000002202684554", CART = "BATIMENT0000002101118190";

describe("magasins d'après photo (D143) : géométrie", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const names: string[] = [];
  const atlas = { get: (text: string) => { names.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas });
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;
  const wall = new THREE.Color("#ece6d8");
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const finite = (s: LandmarkSinks): boolean => s.solid.positions.every(Number.isFinite) && s.glow.positions.every(Number.isFinite);

  it("Lidl : sommets finis, vitrage allumé la nuit, inscription LIDL, coût borné", () => {
    const s = sinks();
    buildStore(s, bOf(LIDL), kinds.buildings[LIDL]!, world.terrain, wall);
    expect(finite(s)).toBe(true);
    expect(tris(s.glow)).toBeGreaterThan(20);
    expect(names).toContain("LIDL");
    expect(tris(s.solid)).toBeGreaterThan(300);
    expect(tris(s.solid)).toBeLessThan(2000);
    // Tout reste près du bâtiment : au plus 5 m au-delà du contour et 12 m de haut.
    const b = bOf(LIDL);
    const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
    const p = s.solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 5);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 5);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 5);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 5);
      expect(p[i + 1]! - b.ground).toBeLessThan(12);
    }
  });

  it("pharmacie : sommets finis, vitrage allumé, nom et croix, coût borné", () => {
    names.length = 0;
    const s = sinks();
    buildStore(s, bOf(PHARMACY), kinds.buildings[PHARMACY]!, world.terrain, wall);
    expect(finite(s)).toBe(true);
    expect(tris(s.glow)).toBeGreaterThan(10);
    expect(names).toContain("Pharmacie de Saint-Pan");
    expect(tris(s.solid)).toBeGreaterThan(200);
    expect(tris(s.solid)).toBeLessThan(1500);
  });

  it("abri à chariots du Lidl : sommets finis, coût borné, panneau Lidl au fond", () => {
    names.length = 0;
    const s = sinks();
    lidlCartShelter(s, bOf(CART), kinds.buildings[CART]!, world.terrain);
    expect(finite(s)).toBe(true);
    expect(names).toContain("LIDL");
    expect(tris(s.solid)).toBeGreaterThan(100);
    expect(tris(s.solid)).toBeLessThan(700);
  });
});
