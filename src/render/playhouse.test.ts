import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, drawsGenericRoof, playhouseFrame, playhouseRing } from "../core/landmarks";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildPlayhouse } from "./playhouse";

const ID = "BATIMENT0000000348854299";

const area = (r: readonly number[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
  }
  return a / 2;
};

describe("théâtre municipal (D223)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[ID]!;
  const m = kind.play!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;

  it("volumes mesurés plausibles (photo et relevé)", () => {
    expect(m).toBeDefined();
    expect(m.w).toBeGreaterThan(22);
    expect(m.w).toBeLessThan(26);
    expect(0 < m.ts && m.ts < m.tt && m.tt < m.tr).toBe(true);
    // Attique vers 17,5 m au-dessus de la place, toit brisé plus haut, cage de scène plus haute encore.
    expect(m.eave - m.g).toBeGreaterThan(16);
    expect(m.eave - m.g).toBeLessThan(19.5);
    expect(m.roof[2]).toBeGreaterThan(m.eave);
    expect(m.roof[3]).toBeGreaterThan(m.roof[2]);
    expect(m.tower[1]).toBeGreaterThan(m.roof[3]);
    // Le pignon avant de la cage de scène dépasse partout du toit du corps avant.
    expect(m.tower[0]).toBeGreaterThan(m.eave);
    // Fronton central (D224) : au-dessus de l'attique, sous le faîtage du corps avant.
    expect(m.fronton).toBeGreaterThan(m.eave + 1);
    expect(m.fronton).toBeLessThan(m.roof[3]);
    expect(drawsGenericRoof(kind)).toBe(false);
  });

  it("obstacle : les murs mesurés, à peu près à la place de l'emprise BD TOPO", () => {
    const ring = playhouseRing(m);
    expect(area(ring)).toBeGreaterThan(0);
    expect(Math.abs(area(ring) / Math.abs(area(b.ring)) - 1)).toBeLessThan(0.15);
    const centre = (r: readonly number[]): [number, number] => {
      let x = 0, y = 0;
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length, c = r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
        x += (r[i]! + r[j]!) * c;
        y += (r[i + 1]! + r[j + 1]!) * c;
      }
      const a6 = 6 * area(r);
      return [x / a6, y / a6];
    };
    const [ax, ay] = centre(ring), [bx, by] = centre(b.ring);
    expect(Math.hypot(ax - bx, ay - by)).toBeLessThan(3);
    // La façade regarde la place (sud-est) : la normale sortante (−t) pointe vers le sud-est.
    const f = playhouseFrame(m);
    const [x0, y0] = at(f, m.w / 2, 0), [x1, y1] = at(f, m.w / 2, -1);
    expect(x1 - x0).toBeGreaterThan(0.5);
    expect(y1 - y0).toBeLessThan(-0.5);
  });

  it("géométrie : sommets finis, dans l'emprise, coût borné, inscription", () => {
    const texts: string[] = [];
    const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
    const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
    buildPlayhouse(sinks, m, world.terrain);
    const p = sinks.solid.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    const tris = p.length / 9;
    expect(tris).toBeGreaterThan(1000);
    // D226 : 10 311 triangles, ornements du toit compris.
    expect(tris).toBeLessThan(12000);
    expect(sinks.glow.positions.length).toBeGreaterThan(0);
    expect(texts).toEqual(["THEATRE"]);
    // three : (x, z, −y) ; tout tient à 5 m de l'emprise mesurée, et sous la pointe de la lyre du pignon arrière.
    const ring = playhouseRing(m);
    const xs = ring.filter((_, i) => i % 2 === 0), ys = ring.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 5);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 5);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 5);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 5);
      // D226 : la lyre et le paratonnerre dépassent du faîtage de la cage de scène d'environ 3 m.
      expect(p[i + 1]!).toBeLessThan(m.tower[1] + 3.5);
    }
  });

  it("perron (D225) : mesuré devant l'avant-corps, on marche sur des marches régulières à moins de 25 cm près", () => {
    const [p0, p1, tFoot, zFoot, zLand] = m.perron;
    expect(p1 - p0).toBeGreaterThan(9);
    expect(Math.abs((p0 + p1) / 2 - m.w / 2)).toBeLessThan(1.5);
    expect(tFoot).toBeLessThan(-1.5);
    expect(tFoot).toBeGreaterThan(-4);
    expect(zLand - zFoot).toBeGreaterThan(0.5);
    expect(zLand - zFoot).toBeLessThan(1.6);
    // Le relief sous les marches : du sol au palier, sans s'écarter du dessus des marches de plus de 25 cm (même pas que le rendu).
    const f = playhouseFrame(m);
    const steps = Math.max(2, Math.round((zLand - zFoot) / 0.15)), riser = (zLand - zFoot) / steps;
    const landing = 0.9, tread = Math.max(0.25, (-tFoot - landing) / steps);
    for (let i = 0; i < steps; i++) {
      const t = -(landing + (steps - 1 - i) * tread) + tread / 2;
      for (const s of [m.w / 2 - 3, m.w / 2, m.w / 2 + 3]) {
        const z = world.terrain.heightAt(...at(f, s, t));
        expect(Math.abs(z - (zFoot + riser * (i + 1)))).toBeLessThan(0.25);
      }
    }
  });
});
