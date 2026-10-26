import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";

const buildings = loadRealWorld().tile.buildings;

function ring(coords: number[]): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < coords.length; i += 2) pts.push(new THREE.Vector2(coords[i]!, coords[i + 1]!));
  if (pts.length > 1 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6) pts.pop();
  return pts;
}

function area(points: THREE.Vector2[]): number {
  return Math.abs(THREE.ShapeUtils.area(points));
}

describe("triangulation des toits (précalculée par tools/data)", () => {
  it("couvre toute la surface de chaque face", () => {
    const bad: string[] = [];
    for (const b of buildings) {
      for (const [i, f] of b.faces.entries()) {
        const contour = ring(f.r);
        const holes = f.h.map(ring);
        const expected = area(contour) - holes.reduce((s, h) => s + area(h), 0);
        if (expected < 0.05) continue;
        const extra: THREE.Vector2[] = [];
        for (let k = 0; f.e && k < f.e.length; k += 2) extra.push(new THREE.Vector2(f.e[k]!, f.e[k + 1]!));
        const verts = [...contour, ...holes.flat(), ...extra];
        let got = 0;
        // Les toits générés n'ont pas de triangles précalculés : le client les calcule (earcut), comme ici.
        const tris: number[][] = [];
        if (f.t) for (let k = 0; k + 2 < f.t.length; k += 3) tris.push([f.t[k]!, f.t[k + 1]!, f.t[k + 2]!]);
        else tris.push(...THREE.ShapeUtils.triangulateShape(contour, holes));
        for (const [a, c, d] of tris) got += area([verts[a!]!, verts[c!]!, verts[d!]!]);
        if (Math.abs(got - expected) / expected > (f.e ? 0.1 : 0.02)) bad.push(`${b.id}#${i} attendu ${expected.toFixed(2)} m², obtenu ${got.toFixed(2)} m²`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});
