import { describe, expect, it } from "vitest";
import { extentOf, lanePoint } from "./driver";
import { flatTerrain, loadRealRoadWorld } from "./testing";
import { TrafficSim } from "./traffic-sim";
import { moveEdge, reverseMove } from "./road-graph";
import { createVehicle } from "./vehicle";
import { vehicleDef } from "./vehicle-catalog";
import { contactVehicles } from "./vehicle-contact";

const real = loadRealRoadWorld();
const { nav, colliders, world } = real;
const DT = 1 / 60;
const citadine = vehicleDef("citadine")!.spec;

/** Une route droite et large (pour des essais sans virage) : arête d'au moins 150 m, ≥ 5,5 m, presque sans courbure. */
function straightRoad(): number {
  for (const m of real.starts(1, 150)) {
    const e = moveEdge(m);
    if (nav.road.edgeWidth(e) < 5.5 || nav.road.oneway(e)) continue;
    const poly: number[] = [];
    const n = nav.road.polyline(e, poly);
    const h0 = Math.atan2(poly[2]! - poly[0]!, poly[3]! - poly[1]!), h1 = Math.atan2(poly[n * 2 - 2]! - poly[0]!, poly[n * 2 - 1]! - poly[1]!);
    if (Math.abs(h1 - h0) < 0.05 && nav.road.canGo(m) && nav.road.canGo(reverseMove(m))) return m;
  }
  throw new Error("aucune route droite et large");
}

describe("chocs entre véhicules", () => {
  const flat = flatTerrain();
  const make = (x: number, heading: number, speed: number, spec = citadine) => {
    const state = createVehicle(x, 0, heading, flat);
    state.vx = Math.sin(heading) * speed;
    state.vy = Math.cos(heading) * speed;
    state.speed = speed;
    return { state, spec };
  };

  it("deux voitures identiques qui se rencontrent de face rebondissent à l'opposé, sans se chevaucher ni gagner de quantité de mouvement", () => {
    const a = make(-3, Math.PI / 2, 8), b = make(3, -Math.PI / 2, 8);
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      a.state.x += a.state.vx * DT;
      b.state.x += b.state.vx * DT;
      if (contactVehicles(a, b)) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    // Après le choc elles s'éloignent, vitesses opposées et plus petites (restitution 0,2).
    expect(a.state.vx).toBeLessThan(0);
    expect(b.state.vx).toBeGreaterThan(0);
    expect(Math.abs(a.state.vx + b.state.vx)).toBeLessThan(0.05);
    expect(Math.abs(a.state.vx)).toBeLessThan(2.5);
    expect(b.state.x - a.state.x).toBeGreaterThan(extentOf(citadine).halfLen * 2 - 0.1 - 6);
  });

  it("le plus léger part le plus loin (conservation de la quantité de mouvement)", () => {
    const light = make(-3, Math.PI / 2, 0, vehicleDef("citadine")!.spec);
    const heavy = make(0, -Math.PI / 2, 6, vehicleDef("camionnette")!.spec);
    const p0 = heavy.spec.mass * heavy.state.vx;
    for (let i = 0; i < 60; i++) {
      heavy.state.x += heavy.state.vx * DT;
      light.state.x += light.state.vx * DT;
      contactVehicles(light, heavy);
    }
    const p1 = light.spec.mass * light.state.vx + heavy.spec.mass * heavy.state.vx;
    expect(Math.abs(p1 - p0) / Math.abs(p0)).toBeLessThan(0.05);
    expect(Math.abs(light.state.vx)).toBeGreaterThan(Math.abs(heavy.state.vx));
  });
});

describe("circulation à plusieurs (J3-2)", () => {
  it("une voiture s'arrête derrière une voiture arrêtée, à une distance de sécurité, sans la toucher", () => {
    const m = straightRoad();
    const sim = new TrafficSim(nav, world.terrain, colliders);
    sim.add(citadine, m, 90, null);
    const f = sim.add(citadine, m, 5, 1, 12);
    let contacts = 0;
    for (let i = 0; i < 60 * 40; i++) {
      sim.step(DT);
      contacts += sim.stats.contacts;
    }
    const lead = sim.cars[0]!;
    const bumper = Math.hypot(lead.state.x - f.state.x, lead.state.y - f.state.y) - 2 * extentOf(citadine).halfLen;
    expect(contacts).toBe(0);
    expect(f.state.speed).toBeLessThan(0.3);
    expect(bumper).toBeGreaterThan(0.5);
    expect(bumper).toBeLessThan(6);
  });

  it("une file de six voitures lancées à 10 m/s s'arrête derrière un obstacle sans aucun choc", () => {
    const m = straightRoad();
    const sim = new TrafficSim(nav, world.terrain, colliders);
    sim.add(citadine, m, 120, null);
    for (let i = 0; i < 6; i++) sim.add(citadine, m, 10 + i * 14, i + 1, 10);
    let contacts = 0;
    for (let i = 0; i < 60 * 50; i++) {
      sim.step(DT);
      contacts += sim.stats.contacts;
    }
    expect(contacts).toBe(0);
    const stopped = sim.cars.slice(1).filter((c) => c.state.speed < 0.3).length;
    expect(stopped).toBe(6);
  });

  it("une voiture en suit une autre à vitesse égale sans la toucher, en gardant plus d'une longueur de voiture", () => {
    const m = straightRoad();
    const sim = new TrafficSim(nav, world.terrain, colliders);
    sim.add(citadine, m, 40, 3, 8);
    sim.add(citadine, m, 8, 4, 8);
    let min = Infinity, contacts = 0;
    for (let i = 0; i < 60 * 25; i++) {
      sim.step(DT);
      contacts += sim.stats.contacts;
      const a = sim.cars[0]!.state, b = sim.cars[1]!.state;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(contacts).toBe(0);
    expect(min).toBeGreaterThan(extentOf(citadine).halfLen * 2 + 0.5);
  });

  it("deux voitures qui se croisent en sens inverse sur une route large passent sans se toucher", () => {
    const m = straightRoad();
    const sim = new TrafficSim(nav, world.terrain, colliders);
    sim.add(citadine, m, 5, 5, 8);
    sim.add(citadine, reverseMove(m), 5, 6, 8);
    let contacts = 0;
    for (let i = 0; i < 60 * 20; i++) {
      sim.step(DT);
      contacts += sim.stats.contacts;
    }
    expect(contacts).toBe(0);
  });

  it("le joueur à pied immobile sur la voie arrête la voiture, qui repart quand il s'écarte", () => {
    const m = straightRoad();
    const sim = new TrafficSim(nav, world.terrain, colliders);
    const f = sim.add(citadine, m, 5, 7, 10);
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 70, lp);
    for (let i = 0; i < 60 * 25; i++) sim.step(DT, { kind: "foot", x: lp.x, y: lp.y, vx: 0, vy: 0 });
    expect(f.state.speed).toBeLessThan(0.3);
    expect(Math.hypot(f.state.x - lp.x, f.state.y - lp.y)).toBeGreaterThan(extentOf(citadine).halfLen + 0.4);
    for (let i = 0; i < 60 * 10; i++) sim.step(DT, { kind: "foot", x: lp.x + 30, y: lp.y + 30, vx: 0, vy: 0 });
    expect(f.state.speed).toBeGreaterThan(3);
  });

  it("30 voitures dans le centre pendant 2 minutes : aucun choc entre voitures plus fort que 3 m/s et très peu de contacts", () => {
    const sim = new TrafficSim(nav, world.terrain, colliders);
    const lp = { x: 0, y: 0, heading: 0 };
    const picks = real.starts(1, 40).filter((m) => {
      lanePoint(nav.road, m, 5, lp);
      return Math.hypot(lp.x, lp.y) < 450;
    });
    const step = Math.max(1, Math.floor(picks.length / 30));
    for (let i = 0; i < picks.length && sim.cars.length < 30; i += step) sim.add(citadine, picks[i]!, 5, 100 + i, 0);
    expect(sim.cars.length).toBeGreaterThanOrEqual(25);
    let contactSteps = 0, worst = 0;
    for (let i = 0; i < 60 * 120; i++) {
      sim.step(DT);
      if (sim.stats.contacts > 0) contactSteps++;
      worst = Math.max(worst, sim.stats.worstImpact);
      for (let k = sim.cars.length - 1; k >= 0; k--) if (sim.cars[k]!.driver?.lost) sim.remove(k);
    }
    console.log(`30 voitures : ${contactSteps} pas avec contact, pire impact ${worst.toFixed(1)} m/s, ${sim.cars.length} restantes`);
    expect(worst).toBeLessThan(3);
    expect(contactSteps).toBeLessThan(60);
  });
});
