import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Building } from "../data/types";

const buildings = JSON.parse(readFileSync("public/data/buildings.json", "utf8")) as Building[];

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
        if (!f.t) {
          bad.push(`${b.id}#${i} sans triangles précalculés`);
          continue;
        }
        for (let k = 0; k < f.t.length; k += 3) got += area([verts[f.t[k]!]!, verts[f.t[k + 1]!]!, verts[f.t[k + 2]!]!]);
        if (Math.abs(got - expected) / expected > (f.e ? 0.1 : 0.02)) bad.push(`${b.id}#${i} attendu ${expected.toFixed(2)} m², obtenu ${got.toFixed(2)} m²`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});
