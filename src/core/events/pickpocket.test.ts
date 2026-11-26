import { describe, expect, it } from "vitest";
import { NavGraph } from "../nav-graph";
import { PedSim, type Observer } from "../pedestrians";
import { loadRealNav, loadRealWorld } from "../testing";
import { buildColliders } from "../world";
import { findPickpocket, PICKPOCKET, PickpocketEvent, type PickpocketEffects } from "./pickpocket";
import { EventRng, type EventContext, type EventPlayer } from "./types";

const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;

interface Log {
  money: number;
  says: string[];
  feats: string[];
  earned: number;
}

function effects(log: Log): PickpocketEffects {
  return {
    say: (_s, t) => log.says.push(t),
    sayPlayer: (t) => log.says.push(`joueur:${t}`),
    cry: () => {},
    earn: (n) => {
      log.earned += n;
      log.money += n;
    },
    take: (n) => {
      const k = Math.min(n, log.money);
      log.money -= k;
      return k;
    },
    feat: (t) => log.feats.push(t),
    crime: () => {},
  };
}

/** Une foule dense (150 passants) au centre ; le joueur debout au milieu. */
function setup(seed: number): { sim: PedSim; player: EventPlayer; ctx: EventContext; obs: () => Observer } {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  const sim = new PedSim(g, terrain, colliders, { capacity: 150, seed });
  const player: EventPlayer = { x: 0, y: -20, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 };
  const obs = (): Observer => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 13 });
  sim.prefill(obs());
  for (let i = 0; i < 120; i++) sim.step(STEP, obs());
  const ctx: EventContext = {
    dt: STEP, player, visible: (x, y) => Math.cos(Math.atan2(x - player.x, y - player.y) - player.yaw) > 0.6, policeNear: () => false,
    lineClear: (x0, y0, x1, y1) => colliders.raycast(x0, y0, x1, y1) === null,
  };
  return { sim, player, ctx, obs };
}

/** Un point du centre où le joueur a au moins 5 passants autour de lui (la foule bouge : on cherche le meilleur). */
function crowdSpot(sim: PedSim, player: EventPlayer): boolean {
  const p = { x: 0, y: 0 }, out: number[] = [];
  for (let i = 0; i < sim.capacity; i++) {
    if (sim.modeOf(i) !== 0) continue;
    sim.position(i, p);
    out.length = 0;
    if (sim.queryCircle(p.x, p.y, PICKPOCKET.crowdRadius - 1, out) >= PICKPOCKET.crowd + 1) {
      player.x = p.x + 0.8;
      player.y = p.y;
      return true;
    }
  }
  return false;
}

function run(sim: PedSim, ev: PickpocketEvent, ctx: EventContext, obs: () => Observer, seconds: number, bot?: () => void, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !ev.done; i++) {
    bot?.();
    sim.step(STEP, obs());
    ev.update(ctx);
    if (until?.()) return;
  }
}

function moveTo(p: EventPlayer, x: number, y: number, v: number): void {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.05) {
    p.vx = p.vy = p.speed = 0;
    return;
  }
  const step = Math.min(d, v * STEP);
  p.vx = (dx / d) * v;
  p.vy = (dy / d) * v;
  p.speed = v;
  p.yaw = Math.atan2(dx, dy);
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
}

describe("pickpocket (phase 4, E2)", () => {
  it("seulement dans une foule dense, à pied, au pas, avec assez d'argent", () => {
    const { sim, player, ctx } = setup(3);
    expect(crowdSpot(sim, player)).toBe(true);
    const rng = new EventRng(1);
    expect(findPickpocket(sim, ctx, 50, rng)).toBe(-1);
    expect(findPickpocket(sim, { ...ctx, player: { ...player, onFoot: false } }, 500, rng)).toBe(-1);
    expect(findPickpocket(sim, { ...ctx, player: { ...player, speed: 4 } }, 500, rng)).toBe(-1);
    // Loin de la foule (au milieu d'une pelouse fictive à 2 km), personne.
    expect(findPickpocket(sim, { ...ctx, player: { ...player, x: 2000, y: 2000 } }, 500, rng)).toBe(-1);
    expect(findPickpocket(sim, ctx, 500, rng)).toBeGreaterThanOrEqual(0);
  });

  it("il frôle le joueur et prend 10 % (20 à 200 €) ; rattrapé en sprint, il lâche l'argent volé plus 50 €", () => {
    let stolen = 0, back = 0, tried = 0;
    for (let seed = 1; seed <= 14 && tried < 6; seed++) {
      const { sim, player, ctx, obs } = setup(seed);
      if (!crowdSpot(sim, player)) continue;
      const slot = findPickpocket(sim, ctx, 800, new EventRng(seed));
      if (slot < 0) continue;
      tried++;
      const log: Log = { money: 800, says: [], feats: [], earned: 0 };
      const ev = new PickpocketEvent(sim, effects(log), slot, () => log.money);
      run(sim, ev, ctx, obs, PICKPOCKET.approachTimeout + 1, undefined, () => ev.phase !== "approach");
      if (ev.phase !== "sneak") continue;
      stolen++;
      expect(ev.stolen).toBe(80);
      expect(log.money).toBe(720);
      expect(log.says).toContain("joueur:Hé ! Mon portefeuille !");
      expect(ev.lawfulTarget(slot)).toBe(true);
      // Le joueur sprinte après lui.
      const t = { x: 0, y: 0 };
      run(sim, ev, ctx, obs, 60, () => {
        sim.position(slot, t);
        moveTo(player, t.x, t.y, 7);
      }, () => (ev.phase as string) === "cash");
      if ((ev.phase as string) !== "cash") continue;
      run(sim, ev, ctx, obs, 10, () => moveTo(player, ev.cashAt.x, ev.cashAt.y, 5));
      if (ev.outcome !== "rattrape") continue;
      back++;
      expect(log.money).toBe(800 + PICKPOCKET.bonus);
      expect(ev.caught).toBe(true);
    }
    expect(tried).toBeGreaterThanOrEqual(4);
    expect(stolen).toBeGreaterThanOrEqual(Math.ceil(tried * 0.6));
    expect(back).toBeGreaterThanOrEqual(Math.ceil(stolen * 0.6));
  });

  it("le joueur ne fait rien : il s'éloigne au pas, puis court, et s'échappe avec l'argent ; personne ne reste réquisitionné", () => {
    let escaped = 0, stolen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { sim, player, ctx, obs } = setup(seed);
      if (!crowdSpot(sim, player)) continue;
      const slot = findPickpocket(sim, ctx, 300, new EventRng(seed));
      if (slot < 0) continue;
      const log: Log = { money: 300, says: [], feats: [], earned: 0 };
      const ev = new PickpocketEvent(sim, effects(log), slot, () => log.money);
      run(sim, ev, ctx, obs, PICKPOCKET.approachTimeout + 1, undefined, () => ev.phase !== "approach");
      if (ev.phase !== "sneak") continue;
      stolen++;
      // Au pas d'abord.
      run(sim, ev, ctx, obs, 2);
      expect(sim.speedOf(slot)).toBeLessThan(2.5);
      run(sim, ev, ctx, obs, 120);
      if (ev.outcome === "enfui") escaped++;
      expect(log.money).toBe(270);
      let borrowed = 0;
      for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i] && sim.isBorrowed(i)) borrowed++;
      expect(borrowed).toBe(0);
    }
    expect(stolen).toBeGreaterThanOrEqual(3);
    expect(escaped).toBe(stolen);
  });
});
