import { describe, expect, it } from "vitest";
import { NODE_FLAG } from "../data/nav";
import { lanePoint } from "./driver";
import { RoadWatch } from "./offenses";
import { moveEdge } from "./road-graph";
import { GREEN, RED, Signals } from "./signals";
import { loadRealRoadWorld } from "./testing";

const { nav, starts } = loadRealRoadWorld();
const road = nav.road;

describe("infractions de conduite (J4)", () => {
  it("excès de vitesse : au-delà de la limite plus 20 km/h, pas en dessous ; rien hors des routes", () => {
    const signals = new Signals(road, { t: 0 });
    const watch = new RoadWatch(() => road, () => signals);
    const m = starts(3, 60, 4)[0]!;
    const p = { x: 0, y: 0, heading: 0 };
    lanePoint(road, m, 20, p);
    const limit = road.edgeSpeed(moveEdge(m));
    watch.update(p.x, p.y, p.heading, (limit + 10) / 3.6, 1 / 60);
    expect(watch.speeding).toBe(false);
    expect(watch.limit).toBe(limit);
    watch.update(p.x, p.y, p.heading, (limit + 25) / 3.6, 1 / 60);
    expect(watch.speeding).toBe(true);
    watch.update(1e5, 1e5, 0, 50, 1 / 60);
    expect(watch.speeding).toBe(false);
  });

  it("feu rouge : franchir un feu au rouge compte une fois ; au vert, rien", () => {
    const clock = { t: 0 };
    const signals = new Signals(road, clock);
    const watch = new RoadWatch(() => road, () => signals);
    // Une approche d'un feu, sur une arête assez longue pour s'y placer.
    let move = -1;
    for (const m of starts(1, 30, 6)) {
      for (const mm of [m, m ^ 1]) {
        if (!road.canGo(mm)) continue;
        if (road.nodeFlags(road.arrivalNode(mm)) & NODE_FLAG.signal) move = mm;
      }
      if (move >= 0) break;
    }
    expect(move).toBeGreaterThanOrEqual(0);
    const len = road.edgeLength(moveEdge(move));
    const p = { x: 0, y: 0, heading: 0 };
    // Juste avant le nœud, dans le sens de la marche.
    lanePoint(road, move, len - 1, p);
    const at = (state: number): void => {
      for (clock.t = 0; clock.t < 200 && signals.carState(move) !== state; clock.t += 0.5);
      expect(signals.carState(move)).toBe(state);
    };
    at(GREEN);
    expect(watch.update(p.x, p.y, p.heading, 10, 1 / 60)).toBe(false);
    at(RED);
    expect(watch.update(p.x, p.y, p.heading, 10, 1 / 60)).toBe(true);
    expect(watch.update(p.x, p.y, p.heading, 10, 1 / 60)).toBe(false);
    // À l'arrêt devant le feu : rien.
    const w2 = new RoadWatch(() => road, () => signals);
    expect(w2.update(p.x, p.y, p.heading, 0.5, 1 / 60)).toBe(false);
  });
});
