import { describe, expect, it } from "vitest";
import { buildPath, Driver, lanePoint } from "./driver";
import { NavGraph } from "./nav-graph";
import { moveEdge } from "./road-graph";
import { loadRealNav, loadRealWorld } from "./testing";
import { createVehicle, stepVehicle } from "./vehicle";
import { CATALOG, vehicleDef } from "./vehicle-catalog";
import { buildColliders } from "./world";

const world = loadRealWorld();
const { cells } = loadRealNav();
const nav = new NavGraph();
for (const c of cells) nav.add(c);
const colliders = buildColliders(world.tile);
const SHIFT = 65536;

/** Sens de départ : arêtes carrossables assez longues, réparties dans le graphe (une sur `every`), dans le sens permis. */
function starts(every: number, minLength = 40, maxClass = 5): number[] {
  const out: number[] = [];
  let k = 0;
  for (const c of cells) {
    for (const e of nav.road.edgesOfSlot(Math.floor(nav.edgesOf(c.id)[0]! / SHIFT))) {
      if (!nav.road.drivable(e) || nav.road.edgeLength(e) < minLength || nav.road.edgeClass(e) > maxClass) continue;
      // Pas au bord du monde (la physique y retient les véhicules à 3 m de la limite).
      if ((nav.road.nodeFlags(nav.road.edgeA(e)) | nav.road.nodeFlags(nav.road.edgeB(e))) & 2) continue;
      if (k++ % every !== 0) continue;
      out.push(nav.road.canGo(e * 2) ? e * 2 : e * 2 + 1);
    }
  }
  return out;
}

interface Run { distance: number; lost: boolean; why: string; crashes: number; worstImpact: number; maxOff: number; maxSpeed: number; seconds: number; moves: number }

/** Fait rouler un conducteur sur la vraie carte : distance, chocs (impact > 1 m/s), écart maximal au tracé. */
function run(model: string, start: number, seed: number, seconds: number): Run {
  const spec = vehicleDef(model)!.spec;
  const lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.road, start, 2, lp);
  const s = createVehicle(lp.x, lp.y, lp.heading, world.terrain);
  const d = new Driver(nav, start, 2, seed, spec, colliders);
  const r: Run = { distance: 0, lost: false, why: "", crashes: 0, worstImpact: 0, maxOff: 0, maxSpeed: 0, seconds: 0, moves: 0 };
  let seen = start;
  for (let i = 0; i < seconds * 60; i++) {
    const input = d.update(s, 1 / 60);
    if (d.lost) {
      r.lost = true;
      r.why = d.lostWhy;
      break;
    }
    s.impact = 0;
    stepVehicle(s, spec, input, 1 / 60, world.terrain, colliders);
    r.distance += Math.max(s.speed, 0) / 60;
    r.maxSpeed = Math.max(r.maxSpeed, s.speed);
    if (s.impact > 1) r.crashes++;
    r.worstImpact = Math.max(r.worstImpact, s.impact);
    const p = d.path!;
    r.maxOff = Math.max(r.maxOff, Math.hypot(p.x[d.index]! - s.x, p.y[d.index]! - s.y));
    if (d.route[0] !== seen) {
      r.moves++;
      seen = d.route[0]!;
    }
    r.seconds = (i + 1) / 60;
  }
  return r;
}

describe("conducteur simulé (J3-1)", () => {
  it("construit un tracé continu, tous les 1,5 m, qui part de la voie de droite et finit sur l'arête voulue", () => {
    const st = starts(40)[0]!;
    const route = [st];
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      out.length = 0;
      nav.road.next(route[route.length - 1]!, out);
      if (!out.length) break;
      route.push(out[0]!);
    }
    const path = buildPath(nav.road, route, 0, (m) => nav.road.edgeSpeed(moveEdge(m)));
    expect(path.n).toBeGreaterThan(20);
    for (let i = 1; i < path.n; i++) expect(Math.hypot(path.x[i]! - path.x[i - 1]!, path.y[i]! - path.y[i - 1]!)).toBeLessThan(1.6);
    for (let i = 0; i < path.n; i++) expect(path.v[i]!).toBeGreaterThan(1);
    // Le profil de vitesse respecte la décélération confortable : jamais plus de 2,4 m/s² entre deux points.
    for (let i = 0; i + 1 < path.n; i++) expect(path.v[i]! * path.v[i]! - path.v[i + 1]! * path.v[i + 1]!).toBeLessThan(2 * 2.4 * 1.5 + 1e-3);
  });

  it("roule sur la voie de droite : décalée d'un quart de chaussée à droite de l'axe sur une route à double sens", () => {
    const st = starts(7).find((m) => !nav.road.oneway(moveEdge(m)) && nav.road.edgeWidth(moveEdge(m)) >= 5)!;
    const lp = { x: 0, y: 0, heading: 0 };
    lanePoint(nav.road, st, 10, lp);
    const axis = { x: 0, y: 0 };
    const e = moveEdge(st);
    nav.road.pointAt(e, (st & 1) === 0 ? 10 : nav.road.edgeLength(e) - 10, axis);
    const d = Math.hypot(lp.x - axis.x, lp.y - axis.y);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2.3);
    // À droite : le produit vectoriel du cap et du décalage est négatif dans le repère nord-est.
    const fx = Math.sin(lp.heading), fy = Math.cos(lp.heading);
    expect(fx * (lp.y - axis.y) - fy * (lp.x - axis.x)).toBeLessThan(0);
  });

  it("fait rouler une citadine 2 minutes depuis 24 points du graphe : jamais perdue hors de la route, chocs rares et légers", () => {
    const list = starts(Math.max(1, Math.floor(starts(1).length / 24)));
    expect(list.length).toBeGreaterThanOrEqual(20);
    const lostWhy = new Map<string, number>();
    let distance = 0, scraped = 0, worst = 0;
    for (const [i, st] of list.entries()) {
      const r = run("citadine", st, 100 + i, 120);
      distance += r.distance;
      worst = Math.max(worst, r.worstImpact);
      if (r.crashes > 0) scraped++;
      if (r.lost) lostWhy.set(r.why, (lostWhy.get(r.why) ?? 0) + 1);
    }
    console.log(`citadine : ${(distance / 1000).toFixed(1)} km, ${scraped}/${list.length} trajets avec un choc, pire ${worst.toFixed(1)} m/s, perdus ${JSON.stringify([...lostWhy])}`);
    // Un conducteur ne se perd jamais en quittant la route ni parce que la route disparaît du graphe ; il peut arriver au bout d'une impasse
    // (le graphe en a 178) ou, rarement, rester bloqué par un obstacle fixe dans une rue de 3 m.
    expect([...lostWhy.keys()].filter((w) => w !== "au bout de la route" && w !== "bloqué à l'arrêt")).toEqual([]);
    expect(lostWhy.get("bloqué à l'arrêt") ?? 0).toBeLessThanOrEqual(Math.ceil(list.length * 0.2));
    expect(scraped).toBeLessThanOrEqual(Math.ceil(list.length * 0.45));
    expect(worst).toBeLessThan(4);
    expect(distance).toBeGreaterThan(list.length * 300);
  });

  it("ne dépasse jamais la vitesse autorisée (× 0,9, plancher 15 km/h) de plus de 10 %", () => {
    for (const st of starts(60).slice(0, 4)) {
      const r = run("berline", st, 7, 60);
      const limit = Math.max(nav.road.edgeSpeed(moveEdge(st)) / 3.6, 15 / 3.6);
      // Les arêtes suivantes peuvent être plus rapides : on compare à la vitesse maximale de la ville plus ces 10 %.
      expect(r.maxSpeed).toBeLessThan(Math.max(limit, 80 / 3.6) * 1.1);
    }
  });

  it("est reproductible : même graine, même route", () => {
    const st = starts(30)[1]!;
    const routeOf = (seed: number): number[] => {
      const spec = vehicleDef("citadine")!.spec;
      const lp = { x: 0, y: 0, heading: 0 };
      lanePoint(nav.road, st, 2, lp);
      const s = createVehicle(lp.x, lp.y, lp.heading, world.terrain);
      const d = new Driver(nav, st, 2, seed, spec, colliders);
      for (let i = 0; i < 60 * 40; i++) {
        s.impact = 0;
        stepVehicle(s, spec, d.update(s, 1 / 60), 1 / 60, world.terrain, colliders);
      }
      return [...d.route];
    };
    expect(routeOf(5)).toEqual(routeOf(5));
  });

  it("tient sa voie avec toutes les voitures du catalogue", () => {
    // Un départ dont la route ne finit pas en impasse tout de suite (essayé avec la citadine).
    const st = starts(50).find((m) => {
      const r = run("citadine", m, 3, 60);
      return !r.lost && r.distance > 400;
    })!;
    expect(st).toBeDefined();
    for (const def of CATALOG.filter((d) => d.family === "car")) {
      const r = run(def.id, st, 3, 60);
      expect([def.id, r.lost, r.crashes]).toEqual([def.id, false, 0]);
      expect(r.maxOff).toBeLessThan(3.5);
      expect(r.distance).toBeGreaterThan(300);
    }
  });
});
