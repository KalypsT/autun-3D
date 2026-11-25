import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EventDirector, type DirectorContext } from "../core/events/director";
import { eventCatalog } from "../core/events/catalog";
import type { SnatchEvent } from "../core/events/snatch";
import type { PickpocketEvent } from "../core/events/pickpocket";
import type { DogEscapeEvent } from "../core/events/dog-escape";
import { SimDogs } from "../core/events/sim-dogs";
import type { PursuitEvent } from "../core/events/pursuit";
import type { MalaiseEvent } from "../core/events/malaise";
import type { PickpocketEffects } from "../core/events/pickpocket";
import type { DogEffects } from "../core/events/dog-escape";
import { OFFICER } from "../core/officers";
import { PedSim, type Observer } from "../core/pedestrians";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { NavManager } from "./nav-manager";
import { Traffic } from "./traffic";

const { world, colliders } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;

/** Bars, cafés et restaurants de la vraie carte (comme `ui-bridge.ts`) : où éclatent les rixes. */
function loadBars(): { x: number; y: number }[] {
  for (const dir of existsSync("public/immuable") ? readdirSync("public/immuable") : []) {
    const f = `public/immuable/${dir}/data/map/places.json`;
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, "utf8")) as { places: { cat: string; kind?: string | null; x: number; y: number }[] };
    return d.places.filter((q) => q.cat === "commerce" && ["bar", "pub", "cafe", "restaurant", "nightclub", "biergarten"].includes(q.kind ?? "")).map((q) => ({ x: q.x, y: q.y }));
  }
  return [];
}
const BARS = loadBars();

interface SoakResult {
  starts: number;
  snatched: number;
  caught: number;
  returned: number;
  escaped: number;
  maxBorrowed: number;
  /** Passants encore réquisitionnés alors qu'aucun événement n'est en cours (doit rester 0). */
  leaked: number;
  bad: number;
  earned: number;
  journal: number;
  /** Départs et issues par événement (« vol:rendu »…), d'après le journal. */
  kinds: Record<string, number>;
  /** Départs par événement. */
  started: Record<string, number>;
  /** Coût du directeur et des événements par image (ms) : moyenne et pire. */
  meanMs: number;
  worstMs: number;
}

/**
 * Endurance des événements (phase 4) : « Fréquents », 100 passants (et leurs chiens) et la vraie circulation (20) autour du centre, un joueur
 * qui se promène à pied et qui se mêle de tout : il rattrape voleurs et pickpockets, rend le sac, ramène le chien à son maître.
 */
function soak(seed: number, minutes: number): SoakResult {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic.setPeds(peds);
  const r: SoakResult = { starts: 0, snatched: 0, caught: 0, returned: 0, escaped: 0, maxBorrowed: 0, leaked: 0, bad: 0, earned: 0, journal: 0, kinds: {}, started: {}, meanMs: 0, worstMs: 0 };
  let money = 1000;
  const fx: PickpocketEffects & DogEffects & { honk(x: number, y: number): void; kneel(on: boolean): void; hurtPlayer(damage: number, fromX: number, fromY: number): void } = {
    say: () => {}, sayPlayer: () => {}, cry: () => {}, bark: () => {}, honk: () => {}, kneel: () => {}, hurtPlayer: () => {}, feat: () => {}, crime: () => {},
    earn: (n) => {
      r.earned += n;
      money += n;
    },
    take: (n) => {
      const k = Math.min(n, money);
      money -= k;
      return k;
    },
  };
  const dogs = new SimDogs(peds);
  const director = new EventDirector(seed);
  director.level = 3;
  for (const d of eventCatalog({ peds: () => peds, dogs: () => dogs, money: () => money, traffic: () => traffic, road: () => nav.graph.road, pedNav: () => nav.graph, bars: () => BARS, fx })) director.register(d);
  const player = { x: 0, y: -20, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 };
  let rng = seed * 7919;
  const rand = (): number => ((rng = (rng * 16807) % 2147483647) / 2147483647);
  let goal = { x: 0, y: -20 }, goalFor = 0;
  const res = { x: 0, y: 0, nx: 0, ny: 0, hit: false };
  const ctx: DirectorContext = {
    dt: DT, player, hour: 15, weekday: 2, rain: 0, zone: 0, stars: 0, blocked: false, crowd: true, traffic: true,
    visible: (x, y) => {
      const a = Math.atan2(x - player.x, y - player.y) - player.yaw;
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.87 && Math.hypot(x - player.x, y - player.y) < 120 && colliders.raycast(player.x, player.y, x, y) === null;
    },
    policeNear: (x, y, rad) => {
      let near = false;
      traffic.forEachPolice((_id, px, py) => (near ||= Math.hypot(px - x, py - y) < rad));
      return near;
    },
    lineClear: (x0, y0, x1, y1) => colliders.raycast(x0, y0, x1, y1) === null,
  };
  const seen = new Set<SnatchEvent>();
  let total = 0, frames = 0;
  const q = { x: 0, y: 0 };
  for (let i = 0; i < minutes * 3600; i++) {
    // Le joueur : il rattrape le voleur d'un vol en cours, ramasse le sac, le rend ; il court après un pickpocket ; il approche au pas un
    // chien échappé, l'attrape et le ramène ; sinon il flâne d'un point à l'autre.
    const ev = director.active.find((e) => e.kind === "vol") as SnatchEvent | undefined;
    const pp = director.active.find((e) => e.kind === "pickpocket") as PickpocketEvent | undefined;
    const dg = director.active.find((e) => e.kind === "chien") as DogEscapeEvent | undefined;
    const pu = director.active.find((e) => e.kind === "poursuite") as PursuitEvent | undefined;
    const ml = director.active.find((e) => e.kind === "malaise") as MalaiseEvent | undefined;
    let target: { x: number; y: number } | null = null, v = 1.4;
    // Quelqu'un fait un malaise à moins de 50 m : on court l'aider (un genou à terre, sans bouger).
    if (ml && (ml.phase === "down" || ml.phase === "care") && !ml.helped && Math.hypot(ml.x - player.x, ml.y - player.y) < 50) {
      if (ml.helpT >= 0) [target, v] = [{ x: player.x, y: player.y }, 0];
      else {
        [target, v] = [{ x: ml.x + 1, y: ml.y }, 5];
        ml.action(player)?.run();
      }
    }
    // Un fugitif à pied à moins de 60 m : on le plaque.
    if (!target && pu && pu.phase === "foot" && pu.runner >= 0) {
      peds.position(pu.runner, q);
      if (Math.hypot(q.x - player.x, q.y - player.y) < 60) [target, v] = [{ ...q }, 7];
    }
    if (!target && pp && (pp.phase === "sneak" || pp.phase === "run")) {
      peds.position(pp.thief, q);
      if (Math.hypot(q.x - player.x, q.y - player.y) < 80) [target, v] = [{ ...q }, 7];
    } else if (pp?.phase === "cash") [target, v] = [{ ...pp.cashAt }, 5];
    if (!target && dg && dg.phase === "loose" && Math.hypot(dg.dog.x - player.x, dg.dog.y - player.y) < 70) {
      [target, v] = [{ x: dg.dog.x, y: dg.dog.y }, 1.6];
      const act = dg.action(player);
      if (act?.verb === "Attraper") act.run();
    } else if (!target && dg?.phase === "led") {
      peds.position(dg.owner, q);
      [target, v] = [{ ...q }, 1.6];
      const act = dg.action(player);
      if (act?.verb === "Rendre") act.run();
    }
    if (ev && !target) {
      if (!seen.has(ev) && ev.phase === "flee") {
        seen.add(ev);
        r.snatched++;
      }
      if (ev.phase === "flee") {
        peds.position(ev.thief, q);
        if (Math.hypot(q.x - player.x, q.y - player.y) < 80) [target, v] = [{ ...q }, 7];
      } else if (ev.phase === "bag") [target, v] = [{ ...ev.bagAt }, 5];
      else if (ev.phase === "carried") {
        peds.position(ev.victim, q);
        [target, v] = [{ ...q }, 5];
        const act = ev.action(player);
        if (act?.label === "Rendre le sac") act.run();
      }
    }
    if (!target) {
      goalFor -= DT;
      if (goalFor <= 0 || Math.hypot(goal.x - player.x, goal.y - player.y) < 2) {
        const hit = nav.graph.nearest(-100 + rand() * 200, -120 + rand() * 200, 30, 0xffff);
        if (hit) goal = { x: hit.x, y: hit.y };
        goalFor = 25;
      }
      target = goal;
    }
    const dx = target.x - player.x, dy = target.y - player.y, d = Math.hypot(dx, dy);
    if (d > 0.3) {
      const step = Math.min(d, v * DT);
      const nx = player.x + (dx / d) * step, ny = player.y + (dy / d) * step;
      colliders.resolveInto(res, nx, ny, 0.35);
      player.vx = (res.x - player.x) / DT;
      player.vy = (res.y - player.y) / DT;
      player.x = res.x;
      player.y = res.y;
      player.speed = Math.hypot(player.vx, player.vy);
      player.yaw = Math.atan2(dx, dy);
    } else player.vx = player.vy = player.speed = 0;
    traffic.step(DT, { kind: "foot", x: player.x, y: player.y, vx: player.vx, vy: player.vy });
    traffic.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: player.speed, hour: 15, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    dogs.step(DT);
    traffic.applyImpacts();
    signals.clock.t += DT;
    // Après les huit premières minutes, un samedi soir (rixes devant les bars ; plus de poursuites).
    const evening = i >= 8 * 3600;
    ctx.hour = evening ? 21 : 15;
    ctx.weekday = evening ? 5 : 2;
    const t0 = performance.now();
    const before = director.journal.length;
    const nb = director.starts;
    director.update(ctx);
    const ms = performance.now() - t0;
    if (director.starts !== nb) {
      const k = director.active[director.active.length - 1]?.kind;
      if (k) r.started[k] = (r.started[k] ?? 0) + 1;
    }
    total += ms;
    frames++;
    r.worstMs = Math.max(r.worstMs, ms);
    for (const j of director.journal.slice(before)) {
      r.kinds[`${j.kind}:${j.outcome}`] = (r.kinds[`${j.kind}:${j.outcome}`] ?? 0) + 1;
      if (j.kind !== "vol") continue;
      if (j.outcome === "rendu") r.returned++;
      if (j.outcome === "enfui") r.escaped++;
    }
    let borrowed = 0;
    for (let k = 0; k < peds.capacity; k++) {
      if (!peds.state.alive![k]) continue;
      if (peds.isBorrowed(k)) borrowed++;
      peds.position(k, q);
      if (!Number.isFinite(q.x + q.y)) r.bad++;
    }
    r.maxBorrowed = Math.max(r.maxBorrowed, borrowed);
    if (director.active.length === 0 && borrowed > 0) r.leaked++;
    if (!Number.isFinite(player.x + player.y)) r.bad++;
  }
  for (const e of seen) if (e.caught) r.caught++;
  r.starts = director.starts;
  r.journal = director.journal.length;
  r.meanMs = total / frames;
  traffic.dispose();
  return r;
}

describe("endurance des événements (phase 4)", () => {
  it("vingt minutes à « Fréquents » au centre, l'après-midi puis le soir : vols, pickpockets, chiens, accidents, poursuites, malaises, rixes ; aucun figurant oublié, rien d'aberrant, un coût négligeable", () => {
    const sum = { starts: 0, snatched: 0, caught: 0, returned: 0, earned: 0, journal: 0, kinds: new Set<string>() };
    for (const seed of [4, 11]) {
      const r = soak(seed, 20);
      // Mesure du lot 1 (D328) : voir la décision pour les chiffres.
      // `EVENTS_SOAK_LOG=fichier` : les chiffres de chaque graine y sont ajoutés (la sortie des tests ne les montre pas).
      if (process.env["EVENTS_SOAK_LOG"]) appendFileSync(process.env["EVENTS_SOAK_LOG"], `graine ${seed} : ${JSON.stringify(r)}\n`);
      expect(r.bad).toBe(0);
      expect(r.leaked).toBe(0);
      // Un grand et un petit événement au plus : un vol (deux figurants) et un accident (deux conducteurs, trois curieux, un gendarme).
      expect(r.maxBorrowed).toBeLessThanOrEqual(8);
      expect(r.meanMs).toBeLessThan(0.2);
      sum.starts += r.starts;
      sum.snatched += r.snatched;
      sum.caught += r.caught;
      sum.returned += r.returned;
      sum.earned += r.earned;
      sum.journal += r.journal;
      for (const k of Object.keys(r.started)) sum.kinds.add(k);
    }
    // Au moins cinq des sept événements du catalogue ont commencé (le tirage en laisse parfois de côté en 40 minutes), dont un grand.
    expect(sum.kinds.size).toBeGreaterThanOrEqual(5);
    expect(["accident", "poursuite", "malaise", "rixe"].some((k) => sum.kinds.has(k))).toBe(true);
    expect(sum.starts).toBeGreaterThanOrEqual(8);
    expect(sum.snatched).toBeGreaterThanOrEqual(1);
    expect(sum.caught).toBeGreaterThanOrEqual(Math.ceil(sum.snatched * 0.5));
    expect(sum.journal).toBeGreaterThanOrEqual(8);
    expect(sum.earned).toBeGreaterThan(0);
  }, 900000);
});
