import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { NODE_FLAG } from "./nav";

// Routes qui finissent à la mer (D287, tools/data/build_dead_ends.py) : aucune route ne mène plus au bord d'une falaise sans être fermée.
const { world, nav } = loadRealRoadWorld();
const { cells } = loadRealNav();
const SHIFT = 65536;
const barriers = world.tile.walls.filter((w) => w.kind === "barrier");
const signs = world.tile.furniture.filter((f) => f.kind === "dead_end");
const plan = JSON.parse(readFileSync("tools/data/dead_ends.json", "utf8")) as { branches: { action: string; name: string }[] };

const COAST = world.manifest.sea!.coast;
const SEA = world.manifest.sea!.z;

function coastDistance(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < COAST.length; i += 2) {
    const j = (i + 2) % COAST.length;
    const ax = COAST[i]!, ay = COAST[i + 1]!, bx = COAST[j]!, by = COAST[j + 1]!;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** Dans la terre (contour du trait de côte), règle pair-impair. */
function onLand(x: number, y: number): boolean {
  let inside = false;
  const n = COAST.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = COAST[2 * i]!, yi = COAST[2 * i + 1]!, xj = COAST[2 * j]!, yj = COAST[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearBarrier(x: number, y: number, r: number): boolean {
  return barriers.some((w) => Math.hypot((w.pts[0]! + w.pts[2]!) / 2 - x, (w.pts[1]! + w.pts[3]!) / 2 - y) < r);
}

describe("routes qui finissent à la mer (D287)", () => {
  it("toute impasse routière à moins de 150 m d'une descente de plus de 10 m vers la côte est fermée par une barrière", () => {
    const open: string[] = [];
    let checked = 0;
    const pts: number[] = [];
    for (const c of cells) {
      for (const e of nav.road.edgesOfSlot(Math.floor(nav.edgesOf(c.id)[0]! / SHIFT))) {
        if (!nav.road.drivable(e)) continue;
        for (const end of [0, 1] as const) {
          const n = nav.road.edgeNode(e, end);
          if (nav.road.nodeFlags(n) & NODE_FLAG.portal || nav.road.arms(n) !== 1) continue;
          // Direction d'arrivée sur le bout : dernier segment de la polyligne de l'arête.
          nav.road.polyline(e, pts);
          const k = end === 1 ? pts.length - 2 : 0, j = end === 1 ? pts.length - 4 : 2;
          const x = pts[k]!, y = pts[k + 1]!;
          const dx = x - pts[j]!, dy = y - pts[j + 1]!, L = Math.hypot(dx, dy) || 1;
          const z0 = world.terrain.heightAt(x, y);
          // Descente vers la mer : droit devant, à moins de 150 m, le rivage (à moins de 40 m du trait de côte, ou en mer), et le sol
          // y descend de plus de 10 m.
          let drop = 0, sea = false;
          for (let d = 10; d <= 150; d += 5) {
            const px = x + (dx / L) * d, py = y + (dy / L) * d;
            drop = Math.max(drop, z0 - Math.max(SEA, world.terrain.heightAt(px, py))); // jusqu'à la surface de l'eau, pas le fond
            if (!onLand(px, py) || coastDistance(px, py) < 40) sea = true;
          }
          if (drop <= 10 || !sea) continue;
          checked++;
          if (!nearBarrier(x, y, 12)) open.push(`${x.toFixed(0)} ; ${y.toFixed(0)} (descente de ${drop.toFixed(0)} m)`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(open).toEqual([]);
  });

  it("les barrières et les panneaux « voie sans issue » sont posés, la liste des branches est relue", () => {
    const cut = plan.branches.filter((b) => b.action === "cut").length;
    expect(barriers.length).toBeGreaterThanOrEqual(cut);
    expect(signs.length).toBeGreaterThan(10);
    // La seule branche gardée telle quelle descend doucement à une plage.
    expect(plan.branches.filter((b) => b.action === "keep").map((b) => b.name)).toEqual(["Avenue du Commandant de Neuchèze"]);
  });

  it("la route de Chalon s'arrête après la piste forestière, avant la falaise", () => {
    const h = nav.road.nearest(2700, 25, 30);
    expect(h).toBeNull(); // plus de route au-delà du bout (2 627 ; 47)
    expect(nearBarrier(2628, 47, 6)).toBe(true);
  });
});
