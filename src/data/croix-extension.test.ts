import { describe, expect, it } from "vitest";
import { moveEdge } from "../core/road-graph";
import { findRoute } from "../core/road-route";
import { loadRealRoadWorld } from "../core/testing";

// L'extension de la Croix de la Libération (D266) : la carte agrandie au sud par la route de Montjeu (RD 256) et la route d'accès,
// fabriquée et greffée par tools/data/extend.py sans refaire la ville.
const { world, nav } = loadRealRoadWorld();
const CROSS = { x: -840.95, y: -1809.25 }; // axe du fût (LiDAR, plan §8.1)
const PARKING = { x: -857, y: -1834 };
const CATHEDRAL = { x: 36.6, y: -571.5 };

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

describe("extension de la Croix de la Libération (D266)", () => {
  it("la croix n'est plus au bord d'une falaise : le relief du LiDAR continue au sud, la côte est à plus de 300 m", () => {
    const z0 = world.terrain.heightAt(CROSS.x, CROSS.y);
    expect(z0 + 330).toBeGreaterThan(585);
    expect(z0 + 330).toBeLessThan(595);
    // Avant D266, le sol tombait à 287 m à 120 m au sud de la croix (falaise de la côte) ; le vrai sol y est à 592 m.
    for (const d of [40, 80, 120, 200]) expect(world.terrain.heightAt(CROSS.x, CROSS.y - d) + 330).toBeGreaterThan(580);
    expect(coastDistance(CROSS.x, CROSS.y)).toBeGreaterThan(300);
    expect(world.manifest.zone[1]).toBeLessThanOrEqual(-2812);
  });

  it("on monte en voiture de la cathédrale au parking de la croix (RD 256, route d'accès)", () => {
    const a = nav.road.nearest(CATHEDRAL.x, CATHEDRAL.y, 60)!;
    const b = nav.road.nearest(PARKING.x, PARKING.y, 40)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const from = nav.road.canGo(a.edge * 2) ? a.edge * 2 : a.edge * 2 + 1;
    const route = findRoute(nav.road, from, b.edge, PARKING.x, PARKING.y, { maxExpand: 200000 });
    expect(route).not.toBeNull();
    expect(moveEdge(route![route!.length - 1]!)).toBe(b.edge);
  });

  it("une voie piétonne passe près de la croix", () => {
    const h = nav.nearest(CROSS.x, CROSS.y, 25);
    expect(h).not.toBeNull();
  });
});
