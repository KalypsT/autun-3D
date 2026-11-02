import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { birdGeometry, BirdView } from "./birds";
import { catGeometry, DogView } from "./dogs";

describe("dessin des animaux (D203)", () => {
  it("héron, martinet, chauve-souris : un corps et deux ailes ; canard : un corps", () => {
    for (const k of ["heron", "swift", "bat", "duck"] as const) {
      const part = birdGeometry(k).getAttribute("part");
      const parts = new Set<number>();
      for (let i = 0; i < part.count; i++) parts.add(part.getX(i));
      expect([...parts].sort()).toEqual(k === "duck" ? [0] : [0, 1, 2]);
    }
    const cat = catGeometry().getAttribute("part");
    expect(cat.count).toBeGreaterThan(100);
  });

  it("un seul maillage par espèce, invisible sans animal", () => {
    const scene = new THREE.Scene();
    const v = new BirdView(scene, "swift", 10);
    v.update([]);
    expect(v.mesh.visible).toBe(false);
    v.update([{ x: 0, y: 0, z: 30, heading: 1, phase: 2, flying: true, coat: 0, size: 1 }]);
    expect(v.mesh.count).toBe(1);
    const c = new DogView(scene, 5, true);
    expect(c.mesh.name).toBe("chats");
    expect(scene.children.length).toBe(3);
  });
});
