import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FeastLights, garlandPairs } from "./feast-lights";

describe("illuminations de Noël (D202)", () => {
  it("une guirlande par paire de lampadaires de 7 à 18 m, chaque lampadaire au plus une fois", () => {
    const lamps = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 30, z: 0 }, { x: 3, y: 0, z: 0 }];
    const pairs = garlandPairs(lamps);
    expect(pairs.length).toBe(1);
    expect(Math.hypot(pairs[0]![0].x - pairs[0]![1].x, pairs[0]![0].y - pairs[0]![1].y)).toBeGreaterThanOrEqual(7);
  });

  it("deux maillages (ampoules, câbles et sapin), montrés seulement pendant les illuminations", () => {
    const scene = new THREE.Scene();
    const l = new FeastLights(scene, [{ x: -30, y: 0, z: 0 }, { x: -20, y: 0, z: 0 }], { x: 0, y: 0, z: 0 });
    expect(scene.children.length).toBe(2);
    l.update(false, 1);
    expect(l.bulbs.visible || l.solid.visible).toBe(false);
    l.update(true, 1);
    expect(l.bulbs.visible && l.solid.visible).toBe(true);
    expect(l.bulbs.geometry.getAttribute("position").count).toBeGreaterThan(70 * 36);
    l.dispose();
  });
});
