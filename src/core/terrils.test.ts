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
  }, 20000); // 4,3 à 4,9 s seul (six montées simulées), plus de 5 s sous la charge de toute la suite (CI de la PR #91).

  it("les passants : les deux sentiers sont reliés aux chemins voisins, un point de vue à chaque sommet (D270)", () => {
    const cell = JSON.parse(readFileSync("public/data/nav/s6_12.json", "utf8")) as { ped: { n: number[]; e: number[] }; poi: number[] };
    const { n, e } = cell.ped;
    const nodes = n.length / 3;
    const adj: number[][] = Array.from({ length: nodes }, () => []);
    let added = 0;
    for (let i = 0; i < e.length; i += 11) {
      adj[e[i]!]!.push(e[i + 1]!);
      adj[e[i + 1]!]!.push(e[i]!);
      if (e[i + 8] === 907818795) added++;
    }
    expect(added).toBe(5);
    // Composante du nœud le plus proche de chaque sommet : elle doit contenir des nœuds d'origine (hors drapeau 32), loin des terrils.
    const nearest = (x: number, y: number): number => {
      let best = 0, d = Infinity;
      for (let k = 0; k < nodes; k++) {
        const dk = Math.hypot(n[3 * k]! - x, n[3 * k + 1]! - y);
        if (dk < d) [d, best] = [dk, k];
      }
      return best;
    };
    for (const v of Object.values(trace)) {
      const seen = new Set([nearest(v.summit[0]!, v.summit[1]!)]);
      const todo = [...seen];
      while (todo.length) for (const m of adj[todo.pop()!]!) if (!seen.has(m)) { seen.add(m); todo.push(m); }
      expect([...seen].some((k) => !(n[3 * k + 2]! & 32) && Math.hypot(n[3 * k]! - v.summit[0]!, n[3 * k + 1]! - v.summit[1]!) > 300)).toBe(true);
      const poi = [];
      for (let i = 0; i < cell.poi.length; i += 5) if (cell.poi[i] === 8 && Math.hypot(cell.poi[i + 1]! - v.summit[0]!, cell.poi[i + 2]! - v.summit[1]!) < 5) poi.push(i);
      expect(poi.length).toBe(1);
    }
  });
});
