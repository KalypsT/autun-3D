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

describe("passants et circulation (J3-3b)", () => {
  /** Un faux passant, immobile, à la position donnée. */
  const fakePed = (get: () => { x: number; y: number; engaged: boolean } | null) => ({
    forEachNear(_x: number, _y: number, _r: number, visit: (x: number, y: number, vx: number, vy: number, engaged: boolean) => void): void {
      const p = get();
      if (p) visit(p.x, p.y, 0, 0, p.engaged);
    },
  });

  it("une voiture s'arrête devant un piéton qui traverse sur un passage, tant qu'il y est, puis repart", () => {
    const stops: { m: number; node: number }[] = [];
    for (const m of real.starts(1, 70, 7)) {
      const node = nav.road.arrivalNode(m);
      if (nav.road.nodeFlags(node) & 32 && !(nav.road.nodeFlags(node) & (4 | 3)) && nav.road.arms(node) === 2 && !nav.road.signAt(m)) stops.push({ m, node });
    }
    expect(stops.length).toBeGreaterThan(8);
    let tested = 0;
    for (const { m, node } of stops.slice(0, 8)) {
      const nx = nav.road.nodeX(node), ny = nav.road.nodeY(node);
      let present = true;
      const sim = new TrafficSim(nav, world.terrain, colliders);
      sim.peds = fakePed(() => (present ? { x: nx, y: ny, engaged: true } : null));
      const car = sim.add(citadine, m, Math.max(nav.road.edgeLength(moveEdge(m)) - 60, 0), 3, 8);
      let min = Infinity;
      for (let i = 0; i < 60 * 25; i++) {
        sim.step(DT);
        min = Math.min(min, Math.hypot(car.state.x - nx, car.state.y - ny));
      }
      // Pendant que le piéton est là, la voiture reste avant le passage, à l'arrêt.
      expect(car.state.speed).toBeLessThan(0.3);
      expect(min).toBeGreaterThan(3);
      present = false;
      let passed = false;
      for (let i = 0; i < 60 * 20 && !car.driver!.lost; i++) {
        sim.step(DT);
        if (Math.hypot(car.state.x - nx, car.state.y - ny) < 2.5) passed = true;
      }
      expect(passed || car.driver!.lost).toBe(true);
      tested++;
    }
    expect(tested).toBe(8);
  });

  it("une voiture s'arrête devant un piéton immobile sur sa voie (hors passage) et ne le touche pas", () => {
    const m = straightRoad();
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 80, lp);
    const sim = new TrafficSim(nav, world.terrain, colliders);
    sim.peds = fakePed(() => ({ x: lp.x, y: lp.y, engaged: false }));
    const car = sim.add(citadine, m, 5, 9, 10);
    for (let i = 0; i < 60 * 30; i++) sim.step(DT);
    expect(car.state.speed).toBeLessThan(0.3);
    const d = Math.hypot(car.state.x - lp.x, car.state.y - lp.y);
    expect(d).toBeGreaterThan(extentOf(citadine).halfLen + 0.35);
    expect(d).toBeLessThan(extentOf(citadine).halfLen + 8);
  });
});

describe("interactions avec le joueur (J3-6)", () => {
  const playerAt = (x: number, y: number, heading: number, speed: number) => {
    const state = createVehicle(x, y, heading, world.terrain);
    state.vx = Math.sin(heading) * speed;
    state.vy = Math.cos(heading) * speed;
    state.speed = speed;
    return { kind: "vehicle" as const, state, spec: citadine };
  };

  it("le joueur arrêté sur la voie : la voiture s'arrête derrière lui, klaxonne au bout de 3 s, puis toutes les 5 s au plus", () => {
    const m = straightRoad();
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 90, lp);
    const sim = new TrafficSim(nav, world.terrain, colliders);
    const car = sim.add(citadine, m, 5, 21, 10);
    const player = playerAt(lp.x, lp.y, lp.heading, 0);
    const times: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      sim.step(DT, player);
      if (sim.honks.length > 0) times.push(i * DT);
    }
    expect(car.state.speed).toBeLessThan(0.3);
    expect(times.length).toBeGreaterThanOrEqual(2);
    // Pas de klaxon avant l'arrêt, puis un espacement d'au moins 5 s.
    expect(times[0]!).toBeGreaterThan(3);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(4.9);
    expect(sim.stats.contacts).toBe(0);
  });

  it("le joueur qui arrive de face sur sa voie à 36 km/h : la voiture freine à temps (moins de 4 m/s quand il est à 20 m) et klaxonne", () => {
    const m = straightRoad();
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 120, lp);
    const sim = new TrafficSim(nav, world.terrain, colliders);
    const car = sim.add(citadine, m, 5, 22, 10);
    const player = playerAt(lp.x, lp.y, lp.heading + Math.PI, 10);
    let honked = false, speedAt20 = -1;
    for (let i = 0; i < 60 * 6; i++) {
      player.state.x += player.state.vx * DT;
      player.state.y += player.state.vy * DT;
      sim.step(DT, player);
      honked ||= sim.honks.length > 0;
      if (speedAt20 < 0 && Math.hypot(car.state.x - player.state.x, car.state.y - player.state.y) < 20) speedAt20 = car.state.speed;
    }
    expect(speedAt20).toBeGreaterThanOrEqual(0);
    expect(speedAt20).toBeLessThan(4);
    expect(honked).toBe(true);
  });

  it("heurtée par le joueur, la voiture freine, s'arrête un moment en klaxonnant, puis reprend sa route sans être perdue", () => {
    const m = straightRoad();
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 5, lp);
    const sim = new TrafficSim(nav, world.terrain, colliders);
    // La voiture roule à 5 m/s ; le joueur la rattrape par l'arrière à 12 m/s.
    const car = sim.add(citadine, m, 40, 23, 5);
    const player = playerAt(lp.x, lp.y, lp.heading, 20);
    let hitAt = -1, honked = false, minSpeedAfter = Infinity, away = false;
    for (let i = 0; i < 60 * 25; i++) {
      if (!away) {
        player.state.x += player.state.vx * DT;
        player.state.y += player.state.vy * DT;
      }
      sim.step(DT, away ? null : player);
      if (hitAt < 0 && sim.stats.contacts > 0) {
        hitAt = i * DT;
        away = true;
      }
      if (hitAt >= 0) {
        honked ||= sim.honks.length > 0;
        if (i * DT < hitAt + 4) minSpeedAfter = Math.min(minSpeedAfter, car.state.speed);
      }
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(honked).toBe(true);
    // Elle s'est arrêtée (ou presque) après le choc, puis repart : dans 25 s elle roule, et n'est pas perdue.
    expect(minSpeedAfter).toBeLessThan(0.6);
    expect(car.driver!.lost).toBe(false);
    expect(car.state.speed).toBeGreaterThan(3);
  });

  it("un coup de klaxon du joueur presse les conducteurs devant lui (+ 10 % pendant 3 s), pas ceux derrière", () => {
    const m = straightRoad();
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, m, 5, lp);
    const run = (horn: boolean): { ahead: number; behind: number } => {
      const sim = new TrafficSim(nav, world.terrain, colliders);
      const ahead = sim.add(citadine, m, 30, 31, 8);
      const behind = sim.add(citadine, m, 5, 32, 8);
      // Le joueur est entre les deux, sur le bas-côté de la route (pas un obstacle), cap de la route.
      const player = playerAt(lp.x + 30, lp.y + 30, lp.heading, 0);
      const lp2 = { x: 0, y: 0, heading: 0 };
      lanePoint(nav.road, m, 18, lp2);
      player.state.x = lp2.x + Math.cos(lp2.heading) * 6;
      player.state.y = lp2.y - Math.sin(lp2.heading) * 6;
      player.state.heading = lp2.heading;
      for (let i = 0; i < 60 * 12; i++) {
        if (horn && i === 60 * 2) sim.playerHorn(lp2.x, lp2.y, lp2.heading);
        sim.step(DT, player);
        if (i === 60 * 4) return { ahead: ahead.state.speed, behind: behind.state.speed };
      }
      return { ahead: 0, behind: 0 };
    };
    const quiet = run(false), noisy = run(true);
    expect(noisy.ahead).toBeGreaterThan(quiet.ahead * 1.04);
    // Celui qui est derrière le joueur n'est pas visé (il peut seulement suivre l'autre).
    expect(noisy.behind).toBeLessThan(noisy.ahead);
  });
});
