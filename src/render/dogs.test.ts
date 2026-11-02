import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createDog } from "../core/dogs";
import { dogGeometry, DogView } from "./dogs";

describe("dessin des chiens (D199)", () => {
  it("un chien : corps, tête, oreilles, museau, queue et quatre pattes, posé au sol, tourné vers −z", () => {
    const g = dogGeometry();
    const part = g.getAttribute("part");
    const parts = new Set<number>();
    for (let i = 0; i < part.count; i++) parts.add(part.getX(i));
    expect([...parts].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 3);
    expect(g.boundingBox!.min.z).toBeLessThan(-0.5);
  });

  it("tous les chiens en un seul maillage instancié, toutes les laisses en un seul ; rien de dessiné sans chien", () => {
    const scene = new THREE.Scene();
    const v = new DogView(scene, 8);
    v.update([], () => 0, () => false);
    expect(v.mesh.visible).toBe(false);
    expect(v.leashes.visible).toBe(false);
    const o = { x: 0, y: 0, heading: 0, speed: 1, sitting: false, fleeing: false };
    const dogs = [createDog(1, 0, o), createDog(2, 1, { ...o, x: 5 })];
    v.update(dogs, () => 1, (_d, out) => (out.set(0, 1.8, 0), true));
    expect(v.mesh.count).toBe(2);
    expect(v.leashes.geometry.drawRange.count).toBe(4);
    expect(scene.children.filter((c) => (c as THREE.Mesh).isMesh || (c as THREE.LineSegments).isLineSegments).length).toBe(2);
    v.dispose();
  });
});
