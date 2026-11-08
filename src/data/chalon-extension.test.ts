import { describe, expect, it } from "vitest";
import { moveEdge } from "../core/road-graph";
import { findRoute } from "../core/road-route";
import { loadRealRoadWorld } from "../core/testing";

// L'extension de la route de Chalon (D286) : l'anse de mer qui coupait la route 400 m avant le chemin des Ragots est comblée, le carrefour
// et le golf d'Autun sont à terre ; fabriquée et greffée par tools/data/extend.py sans refaire la ville.
const { world, nav } = loadRealRoadWorld();
const ANSE = { x: 2091, y: 270 }; // sur la route de Chalon, là où la mer venait à 31 m (relief à 288 m)
const RAGOTS = { x: 2493, y: 86 }; // carrefour de la route de Chalon et du chemin des Ragots
const EDUEN = { x: 1790, y: 427 }; // route de Chalon, au rond-point de l'Eduen
const GOLF = { x: 2560, y: -80 }; // pointe sud-est du golf, en mer avant D286

function coastDistance(x: number, y: number): number {
  const c = world.manifest.sea!.coast;
  let best = Infinity;
  for (let i = 0; i < c.length; i += 2) {
    const j = (i + 2) % c.length;
    const ax = c[i]!, ay = c[i + 1]!, bx = c[j]!, by = c[j + 1]!;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

describe("extension de la route de Chalon (D286)", () => {
  it("la route de Chalon ne descend plus à la mer : le relief monte sans creux du rond-point de l'Eduen au chemin des Ragots", () => {
    // Avant D286, le sol tombait de 328 m à 288 m sur 90 m (falaise, plage, falaise) au milieu de la route.
    let prev = -Infinity;
    for (let s = 0; s <= 1; s += 0.05) {
      const x = EDUEN.x + (RAGOTS.x - EDUEN.x) * s, y = EDUEN.y + (RAGOTS.y - EDUEN.y) * s;
      const z = world.terrain.heightAt(x, y) + 330;
      expect(z).toBeGreaterThan(318);
      expect(z).toBeGreaterThan(prev - 2);
      prev = z;
    }
    expect(world.terrain.heightAt(ANSE.x, ANSE.y) + 330).toBeGreaterThan(325);
    expect(coastDistance(ANSE.x, ANSE.y)).toBeGreaterThan(200);
    expect(coastDistance(RAGOTS.x, RAGOTS.y)).toBeGreaterThan(200);
  });

  it("le golf est à terre, loin du rivage", () => {
    expect(world.terrain.heightAt(GOLF.x, GOLF.y) + 330).toBeGreaterThan(330);
    expect(coastDistance(GOLF.x, GOLF.y)).toBeGreaterThan(100);
  });

  it("on va en voiture du rond-point de l'Eduen au chemin des Ragots par la route de Chalon", () => {
    const a = nav.road.nearest(EDUEN.x, EDUEN.y, 40)!;
    const b = nav.road.nearest(RAGOTS.x, RAGOTS.y, 30)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const from = nav.road.canGo(a.edge * 2) ? a.edge * 2 : a.edge * 2 + 1;
    const route = findRoute(nav.road, from, b.edge, RAGOTS.x, RAGOTS.y, { maxExpand: 200000 });
    expect(route).not.toBeNull();
    expect(moveEdge(route![route!.length - 1]!)).toBe(b.edge);
  });
});
