import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import { createSea, FoamWindow, foamGeometry, liveFoamGeometry, resampleRing, seaGrid, seaSide } from "./sea";

describe("la mer vivante (D316)", () => {
  const { terrain, manifest } = loadRealWorld();
  const sea = manifest.sea!;

  it("l'anneau de côte tourne dans le sens des aiguilles d'une montre : la mer est à gauche", () => {
    expect(seaSide(sea.coast)).toBe(-1);
    // Un carré dans le sens trigonométrique : à droite.
    expect(seaSide([0, 0, 10, 0, 10, 10, 0, 10])).toBe(1);
  });

  it("l'écume est sur l'eau, pas sous la plage (avant D316, elle était posée côté terre et ne se voyait jamais)", () => {
    for (const g of [foamGeometry(sea.coast, sea.z)!, liveFoamGeometry(sea.coast, sea.z)!]) {
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      let under = 0, n = 0;
      // Le sommet le plus au large de chaque colonne (le dernier de la rangée) : le fond y est sous le niveau de la mer.
      const perColumn = g.getAttribute("aFoam") ? 4 : 2;
      for (let i = perColumn - 1; i < pos.count; i += perColumn * 25) {
        n++;
        if (terrain.heightAt(pos.getX(i), -pos.getZ(i)) < sea.z) under++;
      }
      expect(under / n).toBeGreaterThan(0.9);
    }
  });

  it("les triangles des rubans d'écume regardent le ciel (sinon, vus d'en haut, ils disparaissent comme des faces arrière)", () => {
    for (const coast of [sea.coast, [0, 0, 100, 0, 100, 100, 0, 100], [0, 0, 0, 100, 100, 100, 100, 0]]) {
      for (const g of [foamGeometry(coast, 0)!, liveFoamGeometry(coast, 0)!]) {
        const p = g.getAttribute("position") as THREE.BufferAttribute, idx = g.index!;
        let up = 0;
        for (let t = 0; t < idx.count; t += 3 * 50) {
          const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)].map((i) => new THREE.Vector3().fromBufferAttribute(p, i));
          const nrm = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
          if (nrm.y > 0) up++;
        }
        expect(up).toBe(Math.ceil(idx.count / 150));
      }
    }
  });

  it("ruban d'écume vivante : un sommet tous les 2 m environ, profondeur du fond croissante vers le large", () => {
    const pts = resampleRing(sea.coast, 2);
    const g = liveFoamGeometry(sea.coast, sea.z)!;
    expect(g.getAttribute("position").count).toBe((pts.length / 2) * 4);
    const foam = g.getAttribute("aFoam") as THREE.BufferAttribute;
    expect(foam.getY(0)).toBeLessThan(0);
    expect(foam.getY(3)).toBeGreaterThan(2);
    expect(foam.getX(4 * 100)).toBeGreaterThan(150);
  });

  it("seule l'écume proche de la caméra est dessinée (± 800 m le long de la côte)", () => {
    const g = liveFoamGeometry(sea.coast, sea.z)!;
    const w = new FoamWindow(g);
    w.update(-1600, 175);
    expect(g.drawRange.count).toBe(800 * 18);
    const idx = g.index!, p = g.getAttribute("position") as THREE.BufferAttribute;
    const first = idx.getX(g.drawRange.start), last = idx.getX(g.drawRange.start + g.drawRange.count - 1);
    for (const v of [first, last]) expect(Math.hypot(p.getX(v) + 1600, -p.getZ(v) - 175)).toBeLessThan(900);
  });

  it("grille polaire : serrée près du centre, jusqu'à 15 km, en un seul maillage léger", () => {
    const g = seaGrid();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    expect(Math.hypot(pos.getX(96), pos.getZ(96))).toBeCloseTo(1.2, 5);
    expect(Math.hypot(pos.getX(pos.count - 1), pos.getZ(pos.count - 1))).toBeGreaterThanOrEqual(15000);
    expect(g.index!.count / 3).toBeLessThan(30000);
  });

  it("deux appels de dessin, comme avant ; « Mer animée » coupée : la mer plate d'avant", () => {
    const s = createSea(manifest, true)!;
    const shown = (): string[] => {
      const out: string[] = [];
      s.group.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) out.push(o.name); });
      return out;
    };
    expect(shown()).toEqual(["mer", "écume"]);
    s.animated = false;
    expect(shown()).toEqual(["mer", "écume"]);
    expect(s.group.children[1]!.visible).toBe(true);
    s.update(61, 0.2, 0, new THREE.Vector3(0, 1, 0), new THREE.Color());
    expect(s.uniforms.uSeaTime.value).toBeCloseTo(1);
  });
});
