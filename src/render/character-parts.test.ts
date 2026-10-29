import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { recipeFromSeed } from "../core/character";
import { PART_SPECS } from "../core/character-kit";
import { cap, loft, triangleCount } from "./character-shapes";
import { partGeometry, recipeParts, shapeGeometry, slotColors } from "./character-parts";

const verts = (g: THREE.BufferGeometry): Float32Array => g.getAttribute("position").array as Float32Array;

/** Volume signé d'un maillage fermé non indexé : positif quand les faces regardent vers l'extérieur. */
function signedVolume(g: THREE.BufferGeometry): number {
  const p = verts(g);
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += (p[i]! * (p[i + 4]! * p[i + 8]! - p[i + 5]! * p[i + 7]!) - p[i + 1]! * (p[i + 3]! * p[i + 8]! - p[i + 5]! * p[i + 6]!) + p[i + 2]! * (p[i + 3]! * p[i + 7]! - p[i + 4]! * p[i + 6]!)) / 6;
  }
  return v;
}

describe("catalogue de formes", () => {
  it("construit chaque pièce aux deux niveaux de détail, avec les mêmes attributs et des valeurs finies", () => {
    const bad: string[] = [];
    for (const spec of PART_SPECS) {
      for (const lod of [0, 1] as const) {
        const g = partGeometry(spec, lod);
        if (!g) {
          if (lod === 0) bad.push(`${spec.id}: absent de près`);
          continue;
        }
        if (Object.keys(g.attributes).sort().join() !== "color,normal,position,uv") bad.push(`${spec.id}: attributs ${Object.keys(g.attributes).join()}`);
        if (g.index) bad.push(`${spec.id}: indexé`);
        const p = verts(g);
        if (p.length === 0 || p.length % 9 !== 0) bad.push(`${spec.id}: ${p.length}`);
        if (p.some((v) => !Number.isFinite(v))) bad.push(`${spec.id}: valeur non finie`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("garde chaque pièce dans une boîte humaine autour de son os", () => {
    const bad: string[] = [];
    for (const spec of PART_SPECS) {
      const g = shapeGeometry(spec.shape, 0);
      if (!g) continue;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      // Une pièce reste à moins de 1,2 m de son os, et dans 0,6 m de large de chaque côté ; une arme tenue (la batte, 0,9 m au bout de la main) descend plus bas.
      if (b.min.y < (spec.id.startsWith("weapon") ? -1.3 : -0.9) || b.max.y > 1.2 || Math.abs(b.min.x) > 0.6 || Math.abs(b.max.x) > 0.6 || Math.abs(b.min.z) > 0.6 || Math.abs(b.max.z) > 0.6) {
        bad.push(`${spec.id}: ${b.min.toArray().map((v) => v.toFixed(2))} → ${b.max.toArray().map((v) => v.toFixed(2))}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("tient le budget de triangles : ≈ 2 500 de près, ≈ 650 au loin", () => {
    const near: number[] = [], far: number[] = [];
    for (let s = 1; s <= 400; s++) {
      const r = recipeFromSeed(s);
      for (const [lod, list] of [[0, near], [1, far]] as const) {
        list.push(recipeParts(r, lod).reduce((sum, p) => sum + triangleCount(p.geometry) * p.spec.bones.length, 0));
      }
    }
    const avg = (l: number[]): number => l.reduce((a, b) => a + b, 0) / l.length;
    expect(avg(near)).toBeGreaterThan(1800);
    expect(avg(near)).toBeLessThan(2900);
    expect(Math.max(...near)).toBeLessThan(3400);
    expect(avg(far)).toBeGreaterThan(400);
    expect(avg(far)).toBeLessThan(800);
    expect(Math.max(...far)).toBeLessThan(1000);
    expect(avg(far) / avg(near)).toBeLessThan(0.6);
  });

  it("oriente les faces vers l'extérieur (volumes positifs)", () => {
    const closed = loft([{ y: 0, rx: 0.1, rz: 0.08 }, { y: 0.2, rx: 0.12, rz: 0.1 }, { y: 0.4, rx: 0.05, rz: 0.05 }], 8, { capBottom: true, capTop: true });
    expect(signedVolume(closed)).toBeGreaterThan(0.002);
    // Calotte : chaque triangle regarde loin du centre.
    const dome = cap(0, 0, 0, 0.1, 0.12, 0.1, () => 0, () => Math.PI * 0.6, 0, Math.PI * 2, 10, 4);
    const p = verts(dome);
    let inward = 0;
    for (let i = 0; i < p.length; i += 9) {
      const nx = (p[i + 4]! - p[i + 1]!) * (p[i + 8]! - p[i + 2]!) - (p[i + 5]! - p[i + 2]!) * (p[i + 7]! - p[i + 1]!);
      const ny = (p[i + 5]! - p[i + 2]!) * (p[i + 6]! - p[i]!) - (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!);
      const nz = (p[i + 3]! - p[i]!) * (p[i + 7]! - p[i + 1]!) - (p[i + 4]! - p[i + 1]!) * (p[i + 6]! - p[i]!);
      const cx = (p[i]! + p[i + 3]! + p[i + 6]!) / 3, cy = (p[i + 1]! + p[i + 4]! + p[i + 7]!) / 3, cz = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3;
      if (nx * cx + ny * cy + nz * cz < 0) inward++;
    }
    expect(inward).toBe(0);
    // Pièces fermées du catalogue : la tête.
    expect(signedVolume(shapeGeometry("head", 0)!)).toBeGreaterThan(0);
  });

  it("donne des couleurs d'emplacement linéaires et distinctes", () => {
    const a = slotColors(recipeFromSeed(1)), b = slotColors(recipeFromSeed(2));
    expect(a.length).toBe(24);
    expect(a.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
