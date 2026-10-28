import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Fx } from "./fx";

describe("effets de tir (J5-3)", () => {
  it("au repos le maillage est caché (0 appel de dessin) ; avec des effets, un seul maillage quel que soit leur nombre", () => {
    const scene = new THREE.Scene();
    const fx = new Fx(scene);
    fx.update(1 / 60, [], 0);
    expect(fx.mesh.visible).toBe(false);
    expect(fx.count).toBe(0);
    // Dix tirs de fusil à pompe : huit traits, un éclair et des étincelles chacun.
    for (let k = 0; k < 10; k++) {
      fx.flash(0, 0, 1.3);
      for (let i = 0; i < 8; i++) {
        fx.tracer(0, 0, 1.3, i - 4, 12, 1.2);
        fx.sparks(i - 4, 12, 1.2, i % 2 === 0, Math.random);
      }
    }
    fx.update(1 / 60, [], 0);
    expect(fx.mesh.visible).toBe(true);
    expect(fx.count).toBeGreaterThan(100);
    expect(fx.count).toBeLessThanOrEqual(192);
    let meshes = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    // Tout s'éteint en 0,2 s.
    for (let k = 0; k < 22; k++) fx.update(1 / 60, [], 0);
    expect(fx.count).toBe(0);
    expect(fx.mesh.visible).toBe(false);
  });

  it("les armes au sol ajoutent deux instances chacune (caisse et faisceau), toutes les valeurs sont finies", () => {
    const fx = new Fx(new THREE.Scene());
    fx.update(0.5, [{ x: 10, y: 20, z: 3, weapon: "pistol" }, { x: -4, y: 8, z: 2, weapon: "rifle" }], 12.3);
    expect(fx.count).toBe(4);
    for (const v of fx.mesh.instanceMatrix.array.slice(0, 4 * 16)) expect(Number.isFinite(v)).toBe(true);
    // Un trait de longueur nulle ne produit rien (pas de NaN).
    fx.tracer(1, 1, 1, 1, 1, 1);
    fx.update(0.01, [], 0);
    expect(fx.count).toBe(0);
    // Un effet est dessiné au moins une fois même dans une image plus longue que lui (0,1 s en rendu logiciel).
    const long = new Fx(new THREE.Scene());
    long.flash(0, 0, 1);
    long.update(0.1, [], 0);
    expect(long.count).toBe(2);
    long.update(0.1, [], 0);
    expect(long.count).toBe(0);
    for (const v of fx.mesh.instanceMatrix.array.slice(0, 16)) expect(Number.isFinite(v)).toBe(true);
  });
});
