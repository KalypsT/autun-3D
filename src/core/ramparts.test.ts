import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TileData, Wall } from "../data/types";
import { TiledTerrain } from "../data/terrain";
import { Colliders } from "./collision";
import { isProfiled, RAMPART_THICK, rampartOutline, rampartPits, rampartSeams, rampartSides, type ProfiledWall } from "./ramparts";
import { addTileColliders } from "./world";

const PLAYER_RADIUS = 0.3;
const tiles = readdirSync("public/data/tiles").filter((f) => f.endsWith(".json"));
const ramparts: { tile: string; w: Wall }[] = [];
for (const f of tiles) {
  const t = JSON.parse(readFileSync(`public/data/tiles/${f}`, "utf8")) as TileData;
  for (const w of t.walls) if (w.kind === "rampart") ramparts.push({ tile: f.replace(".json", ""), w });
}
const length = (w: Wall): number => {
  let s = 0;
  for (let i = 0; i + 3 < w.pts.length; i += 2) s += Math.hypot(w.pts[i + 2]! - w.pts[i]!, w.pts[i + 3]! - w.pts[i + 1]!);
  return s;
};
const block = (id: string): TiledTerrain["ground"] => {
  const buf = readFileSync(`public/data/terrain/${id}.bin`);
  return TiledTerrain.decodeBlock(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

describe("Remparts, lot 1 (D250) : données", () => {
  it("tous les remparts ont un profil (sommet et sol de chaque côté à chaque sommet), environ 3,1 km en tout", () => {
    expect(ramparts.length).toBeGreaterThan(15);
    for (const { w } of ramparts) expect(isProfiled(w), String(w.id)).toBe(true);
    const total = ramparts.reduce((s, { w }) => s + length(w), 0);
    expect(total).toBeGreaterThan(2900);
    expect(total).toBeLessThan(3400);
  });

  it("sommet : au moins 0,5 m au-dessus du sol le plus haut (parapet), au plus 12 m au-dessus du plus bas", () => {
    for (const { w } of ramparts) {
      const p = w as ProfiledWall;
      p.top.forEach((t, i) => {
        expect(t, `${w.id} sommet ${i}`).toBeGreaterThanOrEqual(Math.max(p.gl[i]!, p.gr[i]!) + 0.49);
        expect(t - Math.min(p.gl[i]!, p.gr[i]!), `${w.id} sommet ${i}`).toBeLessThanOrEqual(12.01);
      });
    }
  });

  it("plus de 2 km de murs de soutènement (un côté plus haut que l'autre d'au moins 2 m), comme au relevé", () => {
    let s = 0;
    for (const { w } of ramparts) {
      const p = w as ProfiledWall;
      for (let i = 0; i + 1 < p.top.length; i++) {
        if (Math.abs(p.gl[i]! - p.gr[i]!) >= 2) s += Math.hypot(p.pts[2 * i + 2]! - p.pts[2 * i]!, p.pts[2 * i + 3]! - p.pts[2 * i + 1]!);
      }
    }
    expect(s).toBeGreaterThan(2000);
  });

  it("la pointe sud (tracé LiDAR, absente d'OSM) part de la tour des Ursulines", () => {
    const near = ramparts.some(({ w }) => {
      for (let i = 0; i < w.pts.length; i += 2) if (Math.hypot(w.pts[i]! - 24, w.pts[i + 1]! + 954) < 3) return true;
      return false;
    });
    expect(near).toBe(true);
  });

  it("rue de la Maladière (D252, photo 7) : le bout de mur absent d'OSM prolonge R06 vers le nord-est, 4 m au moins au-dessus de la rue", () => {
    const hit = ramparts.find(({ w }) => {
      for (let i = 0; i < w.pts.length; i += 2) if (Math.hypot(w.pts[i]! - 940, w.pts[i + 1]! - 175) < 3) return true;
      return false;
    });
    expect(hit).toBeDefined();
    const p = hit!.w as ProfiledWall;
    const i = p.top.findIndex((_, k) => Math.hypot(p.pts[2 * k]! - 940, p.pts[2 * k + 1]! - 175) < 3);
    expect(p.top[i]! - Math.min(p.gl[i]!, p.gr[i]!)).toBeGreaterThan(4);
  });

  it("relief écrêté au pied : côté bas, à 3 m de la face, le relief n'est pas au-dessus du sol mesuré (plus la pente de 0,25)", () => {
    let checked = 0;
    for (const { tile, w } of ramparts) {
      const p = w as ProfiledWall;
      const g = block(tile);
      const { left, right } = rampartSides(w);
      for (let i = 0; i < p.top.length; i++) {
        const lowLeft = p.gl[i]! < p.gr[i]!;
        if (Math.abs(p.gl[i]! - p.gr[i]!) < 2) continue;
        const face = lowLeft ? left : right, low = lowLeft ? p.gl[i]! : p.gr[i]!;
        const ax = p.pts[2 * i]!, ay = p.pts[2 * i + 1]!;
        const fx = face[2 * i]!, fy = face[2 * i + 1]!;
        const d = Math.hypot(fx - ax, fy - ay) || 1;
        const x = fx + ((fx - ax) / d) * 3, y = fy + ((fy - ay) / d) * 3;
        if (x < g.xMin + 2 || x > g.xMax - 2 || y < g.yMin + 2 || y > g.yMax - 2) continue;
        // Bilinéaire entre mailles de 1 m, chacune sous sa propre cible : on laisse la pente d'une maille.
        expect(g.heightAt(x, y), `${tile} ${w.id} sommet ${i}`).toBeLessThanOrEqual(low + 0.25 * 3.5 + 0.3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("Remparts, lot 1 (D250) : géométrie, creux d'affichage, collisions", () => {
  // Mur de soutènement droit d'ouest en est : la ville (gauche, nord) à 10 m, le pied (droite, sud) à 0.
  const wall: ProfiledWall = { id: -1, kind: "rampart", height: 10.5, measured: 10.5, pts: [0, 0, 10, 0, 20, 0], top: [10.5, 10.5, 10.5], gl: [10, 10, 10], gr: [0, 0, 0] };

  it("faces à la demi-épaisseur de part et d'autre ; contour fermé (bouts compris)", () => {
    const { left, right } = rampartSides(wall);
    expect(left[3]).toBeCloseTo(RAMPART_THICK / 2);
    expect(right[3]).toBeCloseTo(-RAMPART_THICK / 2);
    const o = rampartOutline(wall);
    expect(o.length).toBe(2 * (2 * 3) + 2);
    expect(o[0]).toBe(o[o.length - 2]);
    expect(o[1]).toBe(o[o.length - 1]);
  });

  it("creux : côté haut (nord) abaissé sous le sol bas jusqu'à 3,6 m de la face, rien côté bas ni au-delà ; bande fine depuis la face haute", () => {
    expect(rampartSeams(wall)).toHaveLength(1);
    const [pit] = rampartPits([wall]);
    expect(pit!.cap(10, 0)).toBeCloseTo(-0.3);
    expect(pit!.cap(10, 4)).toBeCloseTo(-0.3);
    expect(pit!.cap(10, 5)).toBe(Infinity);
    expect(pit!.cap(10, -3)).toBe(Infinity);
    const cv = pit!.cover![0]!;
    expect(cv.pts[1]).toBeCloseTo(RAMPART_THICK / 2);
    expect(cv.nrm[1]).toBeCloseTo(1);
    expect(cv.width).toBeGreaterThan(6);
  });

  it("un mur libre (même sol des deux côtés) n'a ni creux ni bande", () => {
    expect(rampartPits([{ ...wall, gl: [0, 0, 0] }])).toHaveLength(0);
  });

  it("collisions de la tuile : on est arrêté contre la face, libre à 2 m ; on ne l'escalade pas", () => {
    const tile = JSON.parse(readFileSync("public/data/tiles/28_34.json", "utf8")) as TileData;
    const c = new Colliders();
    addTileColliders(c, { buildings: [], walls: tile.walls.filter((w) => w.kind === "rampart"), furniture: [], trees: [] });
    const w = tile.walls.find((q) => isProfiled(q) && q.pts.length >= 10)!;
    const { right } = rampartSides(w);
    const i = 2, ax = w.pts[2 * i]!, ay = w.pts[2 * i + 1]!, fx = right[2 * i]!, fy = right[2 * i + 1]!;
    const d = Math.hypot(fx - ax, fy - ay);
    const at = (k: number): [number, number] => [fx + ((fx - ax) / d) * k, fy + ((fy - ay) / d) * k];
    const near = at(0.1), far = at(2);
    const r = c.resolve(near[0], near[1], PLAYER_RADIUS);
    expect(Math.hypot(r.x - near[0], r.y - near[1])).toBeGreaterThan(0.1);
    expect(r.wall ?? -1).toBe(-1);
    const r2 = c.resolve(far[0], far[1], PLAYER_RADIUS);
    expect(Math.hypot(r2.x - far[0], r2.y - far[1])).toBeLessThan(0.01);
  });
});
