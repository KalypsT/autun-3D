import { describe, expect, it } from "vitest";
import { conflict, emptyJunction, mustYield, obligationOf, type JunctionState } from "./junction";
import { loadRealRoadWorld } from "./testing";
import { moveEdge } from "./road-graph";
import { TrafficSim } from "./traffic-sim";
import { vehicleDef } from "./vehicle-catalog";

const N = 0, E = Math.PI / 2, S = Math.PI, W = -Math.PI / 2;

/** Un conducteur qui arrive par le sud (cap nord) au carrefour de l'origine et sort avec le cap `out`. */
const approach = (inH: number, out: number, id: number, extra: Partial<JunctionState> = {}): JunctionState => ({ ...emptyJunction(id), active: true, inEdge: id, outEdge: 100 + id, inH, outH: out, turn: Math.atan2(Math.sin(out - inH), Math.cos(out - inH)), dist: 5, cls: 4, ...extra });

describe("règles aux carrefours (pures)", () => {
  it("deux trajets qui se croisent se gênent ; deux trajets parallèles non ; deux sorties sur la même branche oui", () => {
    // Un arrive par le sud et va tout droit (nord) ; l'autre arrive par l'ouest (cap est) et va tout droit.
    expect(conflict(approach(N, N, 1), approach(E, E, 2))).toBe(true);
    // Un arrive par le sud, l'autre par le nord (cap sud) : tout droit tous les deux, files séparées.
    expect(conflict(approach(N, N, 1), approach(S, S, 2))).toBe(false);
    // Deux voitures qui tournent à droite, arrivées de côtés opposés : chacune sa branche, pas de croisement.
    expect(conflict(approach(N, E, 1), approach(S, W, 2))).toBe(false);
    // Tout droit contre un tourne-à-gauche de l'autre côté : les files se croisent.
    expect(conflict(approach(N, N, 1), approach(S, E, 2))).toBe(true);
    // Même branche de sortie, arrivées différentes : fusion.
    expect(conflict(approach(N, N, 1), approach(E, N, 2))).toBe(true);
    // Même branche d'arrivée : jamais en conflit (c'est un suivi).
    expect(conflict(approach(N, N, 1), approach(N, E, 1))).toBe(false);
  });

  it("priorité à droite : on cède à celui qui vient de sa droite, pas de sa gauche", () => {
    // Je vais au nord ; l'autre arrive de l'ouest (cap est) : il est à ma gauche, donc je passe... et il me cède.
    const me = approach(N, N, 1), fromLeft = approach(E, E, 2), fromRight = approach(W, W, 3);
    expect(mustYield(me, fromLeft)).toBe(false);
    expect(mustYield(fromLeft, me)).toBe(true);
    expect(mustYield(me, fromRight)).toBe(true);
  });

  it("le panneau passe avant : stop cède à cédez-le-passage, qui cède à rien ; une route plus importante a priorité ; l'anneau passe avant l'entrant", () => {
    const stop = approach(N, N, 1, { obligation: 2 }), give = approach(E, E, 2, { obligation: 1 }), none = approach(W, W, 3);
    expect(mustYield(stop, give)).toBe(true);
    expect(mustYield(give, stop)).toBe(false);
    expect(mustYield(give, none)).toBe(true);
    expect(mustYield(none, stop)).toBe(false);
    // Même panneau : l'importance de la route.
    const main = approach(N, N, 4, { cls: 1 }), side = approach(W, W, 5, { cls: 4 });
    expect(mustYield(side, main)).toBe(true);
    expect(mustYield(main, side)).toBe(false);
    const ring = approach(E, E, 6, { ring: true }), entering = approach(N, E, 7, { enteringRing: true });
    expect(mustYield(entering, ring)).toBe(true);
    expect(mustYield(ring, entering)).toBe(false);
  });

  it("le tourne-à-gauche cède à celui qui vient en face", () => {
    const left = approach(N, W, 1), straight = approach(S, S, 2);
    expect(mustYield(left, straight)).toBe(true);
    expect(mustYield(straight, left)).toBe(false);
  });

  it("stop 2, cédez-le-passage 1, feux et direction inconnue (+ 8) lus par `obligationOf`", () => {
    expect(obligationOf(1)).toBe(2);
    expect(obligationOf(2)).toBe(1);
    expect(obligationOf(3)).toBe(0);
    expect(obligationOf(9)).toBe(2);
    expect(obligationOf(0)).toBe(0);
  });
});

describe("carrefours réels (J3-2b)", () => {
  const real = loadRealRoadWorld();
  const { nav, colliders, world } = real;
  const spec = vehicleDef("citadine")!.spec;
  const DT = 1 / 60;

  /** Les sens qui arrivent au nœud `node` par une arête assez longue pour y placer une voiture à 25 m. */
  function arrivals(node: number): number[] {
    const edges: number[] = [];
    nav.road.edgesAt(node, edges);
    const out: number[] = [];
    for (const e of edges) {
      if (nav.road.edgeLength(e) < 15) continue;
      const m = nav.road.edgeB(e) === node ? e * 2 : e * 2 + 1;
      if (nav.road.canGo(m) && !(nav.road.edgeA(e) === nav.road.edgeB(e))) out.push(m);
    }
    return out;
  }

  /** Les carrefours à trois branches ou plus, au centre, avec au moins deux arrivées possibles. */
  function junctions(): { node: number; moves: number[] }[] {
    const seen = new Set<string>();
    const out: { node: number; moves: number[] }[] = [];
    for (const m of real.starts(1, 40, 7)) {
      const node = nav.road.arrivalNode(m);
      const key = `${nav.road.nodeX(node).toFixed(1)},${nav.road.nodeY(node).toFixed(1)}`;
      if (seen.has(key) || nav.road.arms(node) < 3 || Math.hypot(nav.road.nodeX(node), nav.road.nodeY(node)) > 1000 || nav.road.nodeFlags(node) & 3) continue;
      seen.add(key);
      const moves = arrivals(node);
      if (moves.length >= 2) out.push({ node, moves });
    }
    return out;
  }

  it("deux voitures qui arrivent ensemble à 100 carrefours réels : aucun interblocage, chocs rares et légers", () => {
    const list = junctions();
    expect(list.length).toBeGreaterThan(60);
    const step = Math.max(1, Math.floor(list.length / 100));
    let tested = 0, contactSteps = 0, deadlocks = 0, passedBoth = 0;
    const bad: string[] = [];
    for (let i = 0; i < list.length; i += step) {
      const { node, moves } = list[i]!;
      const sim = new TrafficSim(nav, world.terrain, colliders);
      const a = moves[0]!, b = moves[1]!;
      const ca = sim.add(spec, a, Math.max(nav.road.edgeLength(moveEdge(a)) - 28, 0), 10 + i, 8);
      const cb = sim.add(spec, b, Math.max(nav.road.edgeLength(moveEdge(b)) - 28, 0), 500 + i, 8);
      const nx = nav.road.nodeX(node), ny = nav.road.nodeY(node);
      let passedA = false, passedB = false, worst = 0;
      for (let k = 0; k < 60 * 45; k++) {
        sim.step(DT);
        contactSteps += sim.stats.contacts > 0 ? 1 : 0;
        worst = Math.max(worst, sim.stats.worstImpact);
        if (Math.hypot(ca.state.x - nx, ca.state.y - ny) < 6) passedA = true;
        if (Math.hypot(cb.state.x - nx, cb.state.y - ny) < 6) passedB = true;
        if (passedA && passedB && Math.hypot(ca.state.x - nx, ca.state.y - ny) > 15 && Math.hypot(cb.state.x - nx, cb.state.y - ny) > 15) break;
      }
      tested++;
      if (passedA && passedB) passedBoth++;
      if ([ca, cb].some((c) => c.driver!.lost && c.driver!.lostWhy.startsWith("interbloqu"))) deadlocks++;
      if (worst > 1.5) bad.push(`${i} (${nx.toFixed(0)},${ny.toFixed(0)}) impact ${worst.toFixed(1)}`);
    }
    console.log(`${tested} carrefours : ${passedBoth} où les deux sont passées, ${contactSteps} pas avec contact, ${deadlocks} interblocages, impacts > 1,5 m/s : ${JSON.stringify(bad)}`);
    expect(tested).toBeGreaterThan(90);
    expect(deadlocks).toBe(0);
    // Les autres cas : une voiture a fini en impasse ou bloquée par un obstacle fixe au carrefour (J3-1), pas par l'autre.
    expect(passedBoth).toBeGreaterThan(tested * 0.7);
    expect(bad.length).toBeLessThanOrEqual(Math.ceil(tested * 0.1));
    expect(Math.max(0, ...bad.map((b) => Number(b.split("impact ")[1])))).toBeLessThan(5.5);
  });

  it("s'arrête complètement devant un stop (même seul sur la route), attend une seconde, puis repart", () => {
    let tested = 0;
    const stops: number[] = [];
    for (const m of real.starts(1, 40, 7)) {
      const sign = nav.road.signAt(m);
      const node = nav.road.arrivalNode(m);
      if ((sign & 7) === 1 && !(sign & 8) && !(nav.road.nodeFlags(node) & 3)) stops.push(m);
    }
    expect(stops.length).toBeGreaterThan(10);
    for (const m of stops.slice(0, 12)) {
      const node = nav.road.arrivalNode(m);
      const nx = nav.road.nodeX(node), ny = nav.road.nodeY(node);
      const sim = new TrafficSim(nav, world.terrain, colliders);
      const car = sim.add(spec, m, Math.max(nav.road.edgeLength(moveEdge(m)) - 45, 0), 7, 9);
      let stoppedNear = 0, minDist = Infinity, afterStop = false, passed = false, lost = false;
      for (let k = 0; k < 60 * 40; k++) {
        sim.step(DT);
        const d = Math.hypot(car.state.x - nx, car.state.y - ny);
        minDist = Math.min(minDist, d);
        if (car.state.speed < 0.3 && d < 14) {
          stoppedNear++;
          afterStop = true;
        }
        if (afterStop && d < 3 && car.state.speed > 1) passed = true;
        if (car.driver!.lost) {
          lost = true;
          break;
        }
        if (passed && d > 12) break;
      }
      tested++;
      expect([minDist < 14, stoppedNear >= 50, passed || lost]).toEqual([true, true, true]);
    }
    expect(tested).toBeGreaterThan(10);
  });
});
