import { appendFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EventDirector, type DirectorContext } from "../core/events/director";
import { eventCatalog } from "../core/events/catalog";
import type { SnatchEvent } from "../core/events/snatch";
import type { EventEffects } from "../core/events/types";
import { OFFICER } from "../core/officers";
import { PedSim, type Observer } from "../core/pedestrians";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { NavManager } from "./nav-manager";
import { Traffic } from "./traffic";

const { world, colliders } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;

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
  /** Coût du directeur et des événements par image (ms) : moyenne et pire. */
  meanMs: number;
  worstMs: number;
}

/**
 * Endurance des événements (phase 4) : « Fréquents », 100 passants et la vraie circulation (20) autour du centre, un joueur qui se promène
 * à pied et qui, quand un vol a lieu à moins de 80 m, sprinte vers le voleur, ramasse le sac et le rend.
 */
function soak(seed: number, minutes: number): SoakResult {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic.setPeds(peds);
  const r: SoakResult = { starts: 0, snatched: 0, caught: 0, returned: 0, escaped: 0, maxBorrowed: 0, leaked: 0, bad: 0, earned: 0, journal: 0, meanMs: 0, worstMs: 0 };
  const fx: EventEffects = { say: () => {}, cry: () => {}, earn: (n) => (r.earned += n), feat: () => {}, crime: () => {} };
  const director = new EventDirector(seed);
  director.level = 3;
  for (const d of eventCatalog({ peds: () => peds, fx })) director.register(d);
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
    // Le joueur : il rattrape le voleur d'un vol en cours, ramasse le sac, le rend ; sinon il flâne d'un point à l'autre.
    const ev = director.active.find((e) => e.kind === "vol") as SnatchEvent | undefined;
    let target: { x: number; y: number } | null = null, v = 1.4;
    if (ev) {
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
    traffic.applyImpacts();
    signals.clock.t += DT;
    const t0 = performance.now();
    const before = director.journal.length;
    director.update(ctx);
    const ms = performance.now() - t0;
    total += ms;
    frames++;
    r.worstMs = Math.max(r.worstMs, ms);
    for (const j of director.journal.slice(before)) {
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
  it("vingt minutes à « Fréquents » au centre : des vols, rattrapés et rendus, aucun figurant oublié, rien d'aberrant, un coût négligeable", () => {
    const sum = { starts: 0, snatched: 0, caught: 0, returned: 0 };
    for (const seed of [4, 11]) {
      const r = soak(seed, 20);
      // Mesure du lot 1 (D328) : voir la décision pour les chiffres.
      // `EVENTS_SOAK_LOG=fichier` : les chiffres de chaque graine y sont ajoutés (la sortie des tests ne les montre pas).
      if (process.env["EVENTS_SOAK_LOG"]) appendFileSync(process.env["EVENTS_SOAK_LOG"], `graine ${seed} : ${JSON.stringify(r)}\n`);
      expect(r.bad).toBe(0);
      expect(r.leaked).toBe(0);
      expect(r.maxBorrowed).toBeLessThanOrEqual(2);
      expect(r.meanMs).toBeLessThan(0.2);
      sum.starts += r.starts;
      sum.snatched += r.snatched;
      sum.caught += r.caught;
      sum.returned += r.returned;
    }
    // Un seul événement au catalogue (lot 1) : un vol toutes les 5 minutes au plus à « Fréquents ».
    expect(sum.starts).toBeGreaterThanOrEqual(4);
    expect(sum.snatched).toBeGreaterThanOrEqual(3);
    expect(sum.caught).toBeGreaterThanOrEqual(Math.ceil(sum.snatched * 0.5));
    expect(sum.returned).toBeGreaterThanOrEqual(1);
  }, 900000);
});
