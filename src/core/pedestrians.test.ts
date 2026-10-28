import { describe, expect, it } from "vitest";
import { pointInRing } from "./collision";
import { NavGraph } from "./nav-graph";
import { PedSim, TIER_RANGE, vehicleThreat, type Observer, type PedEvent, type TrafficBody } from "./pedestrians";
import { loadRealNav, loadRealWorld } from "./testing";
import { buildColliders } from "./world";

const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;

const graph = (): NavGraph => {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  return g;
};
const still = (x = 0, y = -20, hour = 13): Observer => ({ x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour });
const makeSim = (g: NavGraph, n = 100, seed = 7, opt: { tiers?: boolean; avoid?: boolean } = {}): PedSim => new PedSim(g, terrain, colliders, { capacity: n, seed, ...opt });

function run(sim: PedSim, steps: number, obs: Observer | ((t: number) => Observer)): void {
  for (let i = 0; i < steps; i++) sim.step(STEP, typeof obs === "function" ? obs(i * STEP) : obs);
}

describe("simulation des passants", () => {
  it("remplit tous les emplacements, les garde pleins en recyclant, et reste dans la couronne du joueur", () => {
    const sim = makeSim(graph());
    const obs = still();
    sim.prefill(obs);
    expect(sim.stats.alive).toBe(0); // `alive` est mis à jour au pas suivant
    run(sim, 1, obs);
    expect(sim.stats.alive).toBe(100);
    run(sim, 60 * 40, obs);
    expect(sim.stats.alive).toBeGreaterThanOrEqual(95);
    const far: number[] = [];
    const p = { x: 0, y: 0 };
    for (let i = 0; i < sim.capacity; i++) {
      if (!sim.state.alive![i]) continue;
      sim.position(i, p);
      if (Math.hypot(p.x - obs.x, p.y - obs.y) > 230) far.push(i);
    }
    expect(far).toEqual([]);
  });

  it("ne produit ni valeur absurde ni passant dans un bâtiment (positions des passants vivants, un échantillon par seconde)", () => {
    const sim = makeSim(graph(), 120);
    const obs = still();
    sim.prefill(obs);
    const grid = new Map<string, number[][]>();
    const CELL = 64;
    for (const b of tile.buildings) {
      const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
      for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
        for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
          const k = `${i},${j}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(b.ring);
        }
      }
    }
    let total = 0, inside = 0, bad = 0;
    const p = { x: 0, y: 0 };
    for (let t = 0; t < 120; t++) {
      run(sim, 60, obs);
      for (let i = 0; i < sim.capacity; i++) {
        if (!sim.state.alive![i]) continue;
        sim.position(i, p);
        if (!Number.isFinite(p.x + p.y + sim.state.y[i]! + sim.state.yaw[i]! + sim.state.phase[i]!)) bad++;
        total++;
        for (const ring of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? []) {
          if (pointInRing(p.x, p.y, ring)) {
            inside++;
            break;
          }
        }
      }
    }
    expect(bad).toBe(0);
    expect(total).toBeGreaterThan(10000);
    // Les cours intérieures (trous) ne sont pas testées ici : on tolère 0,5 %.
    expect(inside / total).toBeLessThan(0.005);
  });

  it("est reproductible : même graine et mêmes pas donnent le même état, une autre graine un autre", () => {
    const a = makeSim(graph(), 80, 11), b = makeSim(graph(), 80, 11), c = makeSim(graph(), 80, 12);
    const obs = still();
    for (const s of [a, b, c]) {
      s.prefill(obs);
      run(s, 1200, obs);
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(c.checksum());
  });

  it("fait naître les passants à l'écart du joueur et hors de son champ de vision, y compris en roulant à 90 km/h", () => {
    const sim = makeSim(graph(), 100);
    const dist: number[] = [];
    let inView = 0;
    let obs: Observer = still();
    let started = false;
    sim.onSpawn = (slot) => {
      const p = { x: 0, y: 0 };
      sim.position(slot, p);
      if (!started) return; // au départ (prefill), les passants naissent n'importe où : la première image n'est pas vide
      dist.push(Math.hypot(p.x - obs.x, p.y - obs.y));
      if (dist[dist.length - 1]! < 100 && Math.abs(Math.atan2(p.x - obs.x, p.y - obs.y) - obs.yaw) < 0.9) inView++;
    };
    sim.prefill(obs);
    started = true;
    // Le véhicule roule vers l'est, caméra derrière lui, regard vers l'est.
    run(sim, 60 * 25, (t) => (obs = { x: -400 + 25 * t, y: -230, vx: 25, vy: 0, yaw: Math.PI / 2, onFoot: false, vehicle: { x: -400 + 25 * t, y: -230, vx: 25, vy: 0 } }));
    expect(dist.length).toBeGreaterThan(50);
    expect(Math.min(...dist)).toBeGreaterThan(20);
    expect(inView / dist.length).toBeLessThan(0.05);
  });

  it("supporte le retrait d'une super-tuile : les passants qui y marchaient disparaissent, d'autres naissent ailleurs", () => {
    const g = graph();
    const sim = makeSim(g, 100);
    const obs = still(40, 40);
    sim.prefill(obs);
    run(sim, 120, obs);
    const spawnsBefore = sim.stats.spawns;
    const id = "s6_8";
    const cell = cells.find((c) => c.id === id)!;
    g.remove(id);
    run(sim, 60, obs);
    expect(sim.stats.despawns).toBeGreaterThan(0);
    g.add(cell);
    run(sim, 60 * 20, obs);
    expect(sim.stats.alive).toBeGreaterThan(80);
    expect(sim.stats.spawns).toBeGreaterThan(spawnsBefore);
  });

  it("utilise les paliers : la plupart des passants lointains, quelques-uns près ; sans palier tous jouent à fond", () => {
    const sim = makeSim(graph(), 120), full = makeSim(graph(), 120, 7, { tiers: false });
    const obs = still();
    for (const s of [sim, full]) {
      s.prefill(obs);
      run(s, 300, obs);
    }
    expect(sim.stats.tiers[0] + sim.stats.tiers[1] + sim.stats.tiers[2]).toBe(sim.stats.alive);
    expect(sim.stats.tiers[2]).toBeGreaterThan(sim.stats.tiers[0]);
    expect(full.stats.tiers).toEqual([full.stats.alive, 0, 0]);
    expect(TIER_RANGE[0]).toBeLessThan(TIER_RANGE[1]);
  });

  it("suit l'heure et le quartier : monde à midi au centre, presque personne à 3 h, peu en périphérie, et la foule se vide quand la nuit tombe", () => {
    const g = graph();
    const count = (obs: Observer, steps = 1800): { alive: number; target: number } => {
      const sim = makeSim(g, 100);
      sim.prefill(obs);
      run(sim, steps, obs);
      return { alive: sim.stats.alive, target: sim.stats.target };
    };
    const noon = count(still(0, -20, 13)), night = count(still(0, -20, 3));
    expect(noon.target).toBeGreaterThanOrEqual(95);
    expect(noon.alive).toBeGreaterThanOrEqual(90);
    expect(night.target).toBeLessThanOrEqual(6);
    expect(night.alive).toBeLessThanOrEqual(8);
    // Périphérie : au sud-ouest de l'anneau, loin des commerces.
    const outskirts = count(still(-1250, -1500, 13));
    expect(outskirts.target).toBeLessThanOrEqual(35);
    expect(outskirts.alive).toBeLessThanOrEqual(36);
    // La nuit tombe : on part de la foule de midi, l'heure passe à 3 h, la foule se vide (un départ par pas, hors de vue ou loin).
    const sim = makeSim(g, 100);
    sim.prefill(still(0, -20, 13));
    run(sim, 600, still(0, -20, 13));
    expect(sim.stats.alive).toBeGreaterThanOrEqual(90);
    run(sim, 60 * 30, still(0, -20, 3));
    expect(sim.stats.alive).toBeLessThanOrEqual(12);
  });

  it("habille la même personne au même endroit à la même heure, et jamais deux jumeaux vivants", () => {
    const recipes = (hour: number): string[] => {
      const sim = makeSim(graph(), 60, 5);
      sim.prefill(still(0, -20, hour));
      return sim.state.recipes.filter((_, i) => sim.state.alive![i]).map((r) => JSON.stringify(r));
    };
    const a = recipes(13.2), b = recipes(13.7), c = recipes(15.2);
    expect(a).toEqual(b); // même heure de jeu (13), même graine, même ordre de tirage
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(a.length);
  });

  it("repère un véhicule qui arrive sur un passage, mais pas un véhicule arrêté ou qui s'éloigne", () => {
    expect(vehicleThreat(30, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(true);
    expect(vehicleThreat(30, 0, { x: 0, y: 0, vx: 0.2, vy: 0 })).toBe(false);
    expect(vehicleThreat(-30, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(30, 20, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(200, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(30, 0, null)).toBe(false);
  });
});

describe("chocs, esquives et klaxon", () => {
  /** Un passant vivant à l'écart des bâtiments, pris dans une simulation remplie. */
  function setup(): { g: NavGraph; sim: PedSim; slot: number; x: number; y: number } {
    const g = graph();
    const sim = makeSim(g, 60, 9);
    const obs = still(0, -20);
    sim.prefill(obs);
    run(sim, 30, obs);
    let slot = 0;
    for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i]) {
      slot = i;
      break;
    }
    const p = { x: 0, y: 0 };
    sim.position(slot, p);
    return { g, sim, slot, x: p.x, y: p.y };
  }
  // Une voiture large (1,5 m de rayon) : un passant sur sa trajectoire n'a pas le temps de se mettre à l'abri d'un bond de côté.
  const car = (x: number, y: number, vx: number, vy: number): NonNullable<Observer["vehicle"]> => ({ x, y, vx, vy, heading: Math.atan2(vx, vy), hull: [[1.25, 1.5], [0, 1.5], [-1.25, 1.5]] });

  /** Fait rouler un véhicule vers l'est, à `speed` m/s, sur la ligne du passant (décalée de `offset` m) pendant `seconds` s ; renvoie ce que la simulation a vu. */
  function drive(c: { sim: PedSim; slot: number; x: number; y: number }, speed: number, seconds: number, offset = 0): { slow: number; events: PedEvent[]; fell: boolean } {
    const p = { x: 0, y: 0 };
    const out = { slow: 0, events: [] as PedEvent[], fell: false };
    const x0 = c.x - 6 - speed;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      c.sim.position(c.slot, p);
      const vx = x0 + speed * i * STEP, vy = (offset === 0 ? p.y : c.y) + offset; // sur la ligne du passant ; avec un décalage, une ligne fixe (la voiture ne suit pas son bond de côté)
      c.sim.step(STEP, { x: vx, y: vy, vx: speed, vy: 0, yaw: Math.PI / 2, onFoot: false, hour: 13, vehicle: car(vx, vy, speed, 0) });
      out.slow = Math.max(out.slow, c.sim.impact.slow);
      out.events.push(...c.sim.events.filter((e) => e.slot === c.slot));
      c.sim.clearEvents();
      if (c.sim.state.pose![c.slot] === 2) out.fell = true;
    }
    return out;
  }

  it("fait tomber un passant percuté à 36 km/h, ralentit le véhicule de 10 à 30 %, puis le passant se relève sur une file", () => {
    const c = setup();
    const r = drive(c, 10, 2);
    expect(r.events.filter((e) => e.kind === "hit")).toHaveLength(1); // un seul choc, pas un par pas
    expect(r.fell).toBe(true);
    expect(r.slow).toBeGreaterThanOrEqual(0.1);
    expect(r.slow).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(c.sim.stats.knocked).toBeGreaterThan(0);
    // À terre un moment, puis il se relève et reprend une file.
    run(c.sim, 60 * 5, still(0, -20));
    expect(c.sim.state.pose![c.slot]).toBe(0);
    const p = { x: 0, y: 0 };
    c.sim.position(c.slot, p);
    expect(Number.isFinite(p.x + p.y)).toBe(true);
    expect(c.g.nearest(p.x, p.y, 40)).not.toBeNull();
  });

  it("un véhicule de la circulation (`Observer.vehicles`) heurte un passant comme celui du joueur : le passant tombe, la voiture perd 10 à 30 % de sa vitesse, un seul choc", () => {
    const c = setup();
    const p = { x: 0, y: 0 };
    const body: TrafficBody = { x: 0, y: 0, vx: 10, vy: 0, heading: Math.PI / 2, hull: [[1.25, 1.5], [0, 1.5], [-1.25, 1.5]], slow: 0, speed: 0, hits: 0 };
    let slow = 0, hits = 0, fell = false;
    const events: PedEvent[] = [];
    for (let i = 0; i < 120; i++) {
      c.sim.position(c.slot, p);
      body.x = c.x - 16 + 10 * i * STEP;
      body.y = p.y;
      body.slow = 0;
      body.hits = 0;
      c.sim.step(STEP, { ...still(0, -20), onFoot: true, vehicles: [body] });
      slow = Math.max(slow, body.slow);
      hits += body.hits;
      events.push(...c.sim.events.filter((e) => e.slot === c.slot));
      c.sim.clearEvents();
      if (c.sim.state.pose![c.slot] === 2) fell = true;
    }
    expect(events.filter((e) => e.kind === "hit")).toHaveLength(1);
    expect(fell).toBe(true);
    expect(slow).toBeGreaterThanOrEqual(0.1);
    expect(slow).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(hits).toBe(1);
    // Le véhicule du joueur n'a rien subi : l'effet est sur la voiture de la circulation.
    expect(c.sim.impact.slow).toBe(0);
  });

  it("fait seulement trébucher un passant à 2 m/s, et pousse sans faire tomber un véhicule qui avance au pas", () => {
    const a = setup();
    const r = drive(a, 2, 9);
    expect(r.events.some((e) => e.kind === "stumble")).toBe(true);
    expect(r.events.some((e) => e.kind === "hit")).toBe(false);
    expect(r.fell).toBe(false);
    expect(r.slow).toBeLessThan(0.1);
    const b = setup();
    const w = drive(b, 0.8, 12);
    expect(w.events.filter((e) => e.kind === "hit" || e.kind === "stumble")).toEqual([]);
    expect(b.sim.stats.hits).toBe(0);
  });

  it("n'atteint pas un passant que le véhicule frôle à 1,9 m, mais le fait sursauter", () => {
    const c = setup();
    const r = drive(c, 14, 2.4, -1.9);
    expect(r.events.filter((e) => e.kind === "hit" || e.kind === "stumble")).toEqual([]);
    expect(r.events.some((e) => e.kind === "startled" || e.kind === "near_miss")).toBe(true);
  });

  it("fait sursauter les passants devant un klaxon, pas ceux derrière", () => {
    const g = graph();
    const sim = makeSim(g, 100, 4);
    const obs = still(0, -20);
    sim.prefill(obs);
    run(sim, 60, obs);
    const veh = car(0, -20, 0, 6);
    sim.clearEvents();
    sim.step(STEP, { ...still(0, -20), onFoot: false, vehicle: veh, horn: true });
    const p = { x: 0, y: 0 };
    const startled = sim.events.filter((e) => e.kind === "startled");
    expect(startled.length).toBeGreaterThan(0);
    for (const e of startled) {
      sim.position(e.slot, p);
      const d = Math.hypot(p.x, p.y + 20);
      expect(d).toBeLessThan(36);
      expect(Math.cos(Math.atan2(p.x, p.y + 20))).toBeGreaterThan(Math.cos(0.9)); // devant (cap nord)
    }
  });

  it("une sonnette (portée de 15 m) ne fait sursauter que les passants proches, un klaxon de voiture (35 m) aussi ceux qui sont plus loin", () => {
    const startledAt = (hornRange: number | undefined): number[] => {
      const sim = makeSim(graph(), 100, 4);
      const obs = still(0, -20);
      sim.prefill(obs);
      run(sim, 60, obs);
      sim.clearEvents();
      sim.step(STEP, { ...still(0, -20), onFoot: false, vehicle: { ...car(0, -20, 0, 6), ...(hornRange === undefined ? {} : { hornRange }) }, horn: true });
      const p = { x: 0, y: 0 };
      return sim.events.filter((e) => e.kind === "startled").map((e) => (sim.position(e.slot, p), Math.hypot(p.x, p.y + 20)));
    };
    const bell = startledAt(15), horn = startledAt(35), def = startledAt(undefined);
    expect(bell.every((d) => d <= 15)).toBe(true);
    expect(horn.some((d) => d > 15)).toBe(true);
    expect(horn.length).toBeGreaterThan(bell.length);
    expect(def).toEqual(horn);
  });

  it("cède la place au joueur à pied qui le bouscule, et fait trébucher celui qui lui fonce dessus en courant", () => {
    const { sim, slot, x, y } = setup();
    const before = { x: 0, y: 0 }, after = { x: 0, y: 0 };
    sim.position(slot, before);
    sim.clearEvents();
    sim.step(STEP, { x: x + 0.3, y, vx: 1, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 13 });
    sim.position(slot, after);
    expect(sim.impact.bump).toBeGreaterThan(0);
    expect(Math.hypot(after.x - (x + 0.3), after.y - y)).toBeGreaterThan(0.45); // il s'est écarté du joueur
    const r = setup();
    r.sim.clearEvents();
    r.sim.step(STEP, { x: r.x + 0.3, y: r.y, vx: 5, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 13 });
    expect(r.sim.events.some((e) => e.kind === "stumble")).toBe(true);
    expect(r.sim.state.pose![r.slot]).toBe(1);
  });
});

describe("entrées pour les autres systèmes", () => {
  it("trouve les passants dans un cercle et les pousse : tombent au-dessus de 3,5 m/s, trébuchent en dessous, se relèvent ensuite", () => {
    const sim = makeSim(graph(), 80, 3);
    const obs = still(0, -20);
    sim.prefill(obs);
    run(sim, 30, obs);
    const found: number[] = [];
    const n = sim.queryCircle(0, -20, 120, found);
    expect(n).toBe(found.length);
    expect(n).toBeGreaterThan(20);
    const [a, b] = found as [number, number];
    sim.clearEvents();
    sim.applyImpulse(a, 6, 0);
    sim.applyImpulse(b, 1.5, 0);
    sim.step(STEP, obs);
    expect(sim.state.pose![a]).toBe(2);
    expect(sim.state.pose![b]).toBe(1);
    expect(sim.events.filter((e) => e.kind === "hit" || e.kind === "stumble")).toHaveLength(2);
    // Un passant déjà à terre ne se relève pas pour être poussé de nouveau.
    sim.clearEvents();
    sim.applyImpulse(a, 6, 0);
    expect(sim.events.filter((e) => e.kind === "hit")).toHaveLength(0);
    run(sim, 60 * 5, obs);
    expect(sim.state.pose![a]).toBe(0);
    expect(sim.state.pose![b]).toBe(0);
    expect(sim.stats.knocked).toBe(0);
  });

  it("à l'arrêt au centre, la foule ne se renouvelle pas en boucle (régression : 20 naissances par seconde mesurées sur téléphone)", () => {
    const sim = makeSim(graph());
    const obs = still(-27.9, -15.1, 16);
    sim.prefill(obs);
    run(sim, 30, obs);
    const before = sim.stats.spawns;
    run(sim, 60, obs);
    expect(sim.stats.spawns - before).toBeLessThan(150);
    expect(sim.stats.alive).toBeGreaterThanOrEqual(sim.stats.target - 2);
    expect(sim.stats.alive).toBeLessThanOrEqual(sim.stats.target + 1);
  });
});
