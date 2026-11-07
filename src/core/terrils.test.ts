import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { loadRealWorld } from "./testing";
import { MTB } from "./vehicle-specs";
import { BIKE, CAR, createVehicle, stepVehicle, type VehicleSpec } from "./vehicle";

/** Sentiers en lacets des terrils des Télots (D269) : axe (x, y, altitude du sentier), du sommet au pied. */
const doc = JSON.parse(readFileSync("tools/data/terrils.json", "utf8")) as Record<string, unknown>;
const trace = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "_doc")) as Record<string, { summit: number[]; path: number[][] }>;

/** Monte le sentier `name` du pied au sommet (25 km/h au plus), en visant un point 6 m plus loin sur l'axe ; rend l'écart à l'axe et l'altitude atteinte. */
function climb(name: string, spec: VehicleSpec, seconds: number): { reached: number; worst: number; top: number } {
  const world = loadRealWorld();
  const none = new Colliders();
  const path = [...trace[name]!.path].reverse();
  const [x0, y0] = path[0]!, [x1, y1] = path[3]!;
  const s = createVehicle(x0!, y0!, Math.atan2(x1! - x0!, y1! - y0!), world.terrain);
  let i = 0, worst = 0;
  for (let n = 0; n < seconds * 60 && i < path.length - 8; n++) {
    let best = Infinity;
    for (let j = i; j < Math.min(path.length, i + 30); j++) {
      const d = Math.hypot(path[j]![0]! - s.x, path[j]![1]! - s.y);
      if (d < best) [best, i] = [d, j];
    }
    worst = Math.max(worst, best);
    const [tx, ty] = path[Math.min(path.length - 1, i + 6)]!;
    const want = Math.atan2(tx! - s.x, ty! - s.y);
    const d = ((want - s.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    // Pas plus de 25 km/h (les virages sont serrés) : plein gaz en dessous, frein au-dessus de 30 km/h.
    const v = s.speed * 3.6;
    stepVehicle(s, spec, { throttle: v < 25 ? 1 : 0, brake: v > 30 ? 1 : 0, steer: Math.max(-1, Math.min(1, d * 3)) }, 1 / 60, world.terrain, none);
  }
  return { reached: i / (path.length - 1), worst, top: s.z };
}

describe("terrils des Télots (D269)", () => {
  it("le sentier descend du sommet au pied sans dépasser 16 % ni remonter", () => {
    for (const { path } of Object.values(trace)) {
      expect(path[0]![2]! - path[path.length - 1]![2]!).toBeGreaterThan(75);
      for (let k = 1; k < path.length; k++) {
        const run = Math.hypot(path[k]![0]! - path[k - 1]![0]!, path[k]![1]! - path[k - 1]![1]!);
        const drop = path[k - 1]![2]! - path[k]![2]!;
        expect(drop).toBeGreaterThanOrEqual(-1e-6);
        expect(drop / run).toBeLessThan(0.165);
      }
    }
  });

  it("à vélo, en VTT et en voiture, on monte les lacets jusqu'au sommet", () => {
    for (const name of ["est", "ouest"]) {
      for (const spec of [BIKE, MTB, CAR]) {
        const r = climb(name, spec, 600);
        expect(r.reached, `${name}`).toBeGreaterThan(0.97);
        // Sur le sentier (2,5 m, élargi à 6,5 m dans les virages) ; la voiture, plus large de braquage, mord sur le replat des virages.
        expect(r.worst).toBeLessThan(spec === CAR ? 5 : 3);
        expect(r.top).toBeGreaterThan(trace[name]!.summit[2]! - 3);
      }
    }
  });
});
