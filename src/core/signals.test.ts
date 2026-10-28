import { describe, expect, it } from "vitest";
import { PED } from "../data/nav";
import { PedSim, PED_STATE, type Observer } from "./pedestrians";
import { AMBER, GREEN, RED, Signals } from "./signals";
import { loadRealRoadWorld } from "./testing";
import { TrafficSim } from "./traffic-sim";
import { vehicleDef } from "./vehicle-catalog";
import { moveEdge } from "./road-graph";
import { NODE_FLAG } from "../data/nav";

const real = loadRealRoadWorld();
const { nav, colliders, world } = real;
const spec = vehicleDef("citadine")!.spec;
const DT = 1 / 60;

/** Les sens qui arrivent à un nœud à feux : un par arête carrossable qui y arrive. */
function arrivalsAt(node: number): number[] {
  const edges: number[] = [];
  nav.road.edgesAt(node, edges);
  const out: number[] = [];
  for (const e of edges) {
    const m = nav.road.edgeB(e) === node ? e * 2 : e * 2 + 1;
    if (nav.road.canGo(m)) out.push(m);
  }
  return out;
}

/** Tous les nœuds à feux du graphe (un par position). */
function signalNodes(): { node: number; arms: number }[] {
  const seen = new Set<string>();
  const out: { node: number; arms: number }[] = [];
  for (const m of real.starts(1, 1, 7)) {
    for (const node of [nav.road.arrivalNode(m), nav.road.departureNode(m)]) {
      const key = `${nav.road.nodeX(node).toFixed(1)},${nav.road.nodeY(node).toFixed(1)}`;
      if (seen.has(key) || !(nav.road.nodeFlags(node) & NODE_FLAG.signal)) continue;
      seen.add(key);
      out.push({ node, arms: nav.road.arms(node) });
    }
  }
  return out;
}

describe("feux de circulation (J3-3)", () => {
  const nodes = signalNodes();

  it("trouve les nœuds à feux du graphe : une cinquantaine, dont quelques carrefours", () => {
    expect(nodes.length).toBeGreaterThan(35);
    expect(nodes.filter((n) => n.arms >= 3).length).toBeGreaterThan(3);
  });

  it("un feu de passage piéton fait 30 s de vert, 3 s d'orange, 7 s de rouge, pareil dans les deux sens", () => {
    const clock = { t: 0 };
    const sig = new Signals(nav.road, clock);
    let tested = 0;
    for (const { node, arms } of nodes.filter((n) => n.arms === 2).slice(0, 10)) {
      const moves = arrivalsAt(node);
      if (moves.length === 0) continue;
      const counts = [0, 0, 0];
      for (let t = 0; t < 40; t += 0.25) {
        clock.t = t;
        const states = moves.map((m) => sig.carState(m));
        expect(new Set(states).size).toBe(1);
        counts[states[0]!]! += 0.25;
      }
      expect(counts).toEqual([30, 3, 7]);
      tested++;
      void arms;
    }
    expect(tested).toBeGreaterThan(5);
  });

  it("à un carrefour, deux branches de groupes différents ne sont jamais vertes ensemble, et chaque groupe a 30 s de vert par cycle de 72 s", () => {
    const clock = { t: 0 };
    const sig = new Signals(nav.road, clock);
    let tested = 0;
    for (const { node } of nodes.filter((n) => n.arms >= 3)) {
      const moves = arrivalsAt(node);
      const greens = new Map<number, number>();
      for (let t = 0; t < 72; t += 0.5) {
        clock.t = t;
        const green = moves.filter((m) => sig.carState(m) === GREEN);
        for (const m of green) greens.set(m, (greens.get(m) ?? 0) + 0.5);
        // Les branches vertes en même temps sont celles d'un même groupe : leurs états sont alors tous verts ou orange, jamais vert contre rouge sur un même axe.
        const states = moves.map((m) => sig.carState(m));
        expect(states.filter((s) => s === GREEN).length === 0 || states.some((s) => s === RED)).toBe(true);
      }
      expect([...greens.values()].every((g) => g === 30)).toBe(true);
      expect(greens.size).toBeGreaterThanOrEqual(2);
      tested++;
    }
    expect(tested).toBeGreaterThan(3);
  });

  it("les piétons traversent quand les voitures de la route traversée sont au rouge depuis une seconde, jamais au vert", () => {
    const clock = { t: 0 };
    const sig = new Signals(nav.road, clock);
    let tested = 0;
    for (const { node } of nodes.filter((n) => n.arms === 2).slice(0, 10)) {
      const moves = arrivalsAt(node);
      if (!moves.length) continue;
      const e = moveEdge(moves[0]!);
      const way = nav.road.edgeWay(e);
      const x = nav.road.nodeX(node), y = nav.road.nodeY(node);
      for (let t = 0; t < 40; t += 0.5) {
        clock.t = t;
        const walk = sig.pedWalk(x, y, way);
        expect(walk).not.toBeNull();
        if (walk) expect(sig.carState(moves[0]!)).toBe(RED);
        if (sig.carState(moves[0]!) === GREEN) expect(walk).toBe(false);
      }
      tested++;
    }
    expect(tested).toBeGreaterThan(5);
    expect(sig.pedWalk(1e5, 1e5, 1)).toBeNull();
  });

  it("une voiture s'arrête au feu rouge, attend, et repart au vert ; elle ne franchit jamais la ligne plus de 2 s après le rouge", () => {
    let tested = 0, redStops = 0;
    for (const { node } of nodes.filter((n) => n.arms === 2)) {
      const m = arrivalsAt(node).find((mm) => nav.road.edgeLength(moveEdge(mm)) >= 70);
      if (m === undefined) continue;
      const sim = new TrafficSim(nav, world.terrain, colliders);
      // On règle l'horloge pour que le feu passe à l'orange quand la voiture est à 70 m, puis au rouge avant qu'elle n'arrive.
      let t0 = -1;
      for (let t = 0; t < 40; t += 0.25) {
        sim.signals.clock.t = t;
        const green = sim.signals.carState(m) === GREEN;
        sim.signals.clock.t = t + 0.5;
        if (green && sim.signals.carState(m) === AMBER) {
          t0 = t;
          break;
        }
      }
      if (t0 < 0) continue;
      sim.signals.clock.t = t0;
      const car = sim.add(spec, m, nav.road.edgeLength(moveEdge(m)) - 70, 5, 10);
      const nx = nav.road.nodeX(node), ny = nav.road.nodeY(node);
      let stoppedAtRed = false, violations = 0, redSince = 0, wentAfter = false, approach: boolean | null = null;
      for (let k = 0; k < 60 * 70; k++) {
        sim.step(DT);
        const d = Math.hypot(car.state.x - nx, car.state.y - ny);
        const red = sim.signals.carState(m) === RED;
        redSince = red ? redSince + DT : 0;
        if (approach === null && d < 22) approach = red;
        if (red && car.state.speed < 0.3 && d < 22) stoppedAtRed = true;
        if (redSince > 2 && d < 2.5 && car.state.speed > 1) violations++;
        if (stoppedAtRed && !red && d < 3) wentAfter = true;
        if (car.driver!.lost) break;
        if (wentAfter && d > 12) break;
      }
      // Les voitures lentes arrivent après le retour du vert : seules celles qui trouvent le feu rouge à 22 m doivent s'arrêter.
      if (approach) {
        tested++;
        if (stoppedAtRed) redStops++;
      }
      expect(violations).toBe(0);
      if (tested >= 8) break;
    }
    expect(tested).toBeGreaterThan(5);
    // Une voiture qui arrive au moment où le feu repasse au vert ne s'arrête pas : tolérance de deux cas.
    expect(redStops).toBeGreaterThanOrEqual(tested - 2);
  });

  it("les passants n'entament une traversée à feux qu'au feu des piétons, jamais pendant que les voitures roulent", () => {
    const sim = new PedSim(nav, world.terrain, colliders, { capacity: 160, seed: 3 });
    const signals = new Signals(nav.road, { t: 0 });
    sim.signals = signals;
    // Un passage à feux près du centre.
    let spot: { x: number; y: number } | null = null;
    const pt = { x: 0, y: 0 };
    for (const e of nav.edgesOf("s7_9")) {
      if (nav.edgeType(e) !== PED.crossingSignal) continue;
      nav.pointAt(e, nav.edgeLength(e) / 2, pt);
      if (!spot || Math.hypot(pt.x, pt.y) < Math.hypot(spot.x, spot.y)) spot = { x: pt.x, y: pt.y };
    }
    expect(spot).not.toBeNull();
    const obs: Observer = { x: spot!.x, y: spot!.y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 13 };
    sim.prefill(obs);
    const priv = sim as unknown as { mode: Uint8Array; edge: Int32Array; x: Float32Array; y: Float32Array };
    const prev = new Uint8Array(160);
    let starts = 0, violations = 0;
    // Sept minutes : assez de traversées pour que le contrôle compte (cinq en cinq minutes depuis les sols du cadastre, D94).
    for (let k = 0; k < 60 * 420; k++) {
      signals.clock.t += DT;
      sim.step(DT, obs);
      for (let i = 0; i < 160; i++) {
        const m = priv.mode[i]!;
        if (m === PED_STATE.cross && prev[i] !== PED_STATE.cross && nav.edgeType(priv.edge[i]!) === PED.crossingSignal) {
          starts++;
          if (signals.pedWalk(priv.x[i]!, priv.y[i]!, nav.edgeWay(priv.edge[i]!)) === false) violations++;
        }
        prev[i] = m;
      }
    }
    console.log(`traversées à feux commencées : ${starts}, hors du feu des piétons : ${violations}`);
    expect(starts).toBeGreaterThan(5);
    expect(violations).toBe(0);
  });
});
