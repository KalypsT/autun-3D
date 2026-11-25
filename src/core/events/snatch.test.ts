import { describe, expect, it } from "vitest";
import { NavGraph } from "../nav-graph";
import { PED_STATE, PedSim, type Observer } from "../pedestrians";
import { loadRealNav, loadRealWorld } from "../testing";
import { buildColliders } from "../world";
import { findSnatchSite, SNATCH, SnatchEvent } from "./snatch";
import { EventRng, type EventContext, type EventEffects, type EventPlayer } from "./types";

const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;

interface Log {
  says: string[];
  cries: string[];
  earned: number;
  feats: string[];
  crimes: string[];
}

function effects(log: Log): EventEffects {
  return {
    say: (_s, text) => log.says.push(text),
    cry: (kind) => log.cries.push(kind),
    earn: (n) => (log.earned += n),
    feat: (t) => log.feats.push(t),
    crime: (k) => log.crimes.push(k),
  };
}

function world(seed: number, at = { x: 0, y: -20 }): { sim: PedSim; player: EventPlayer; ctx: EventContext; obs: () => Observer } {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  const sim = new PedSim(g, terrain, colliders, { capacity: 100, seed });
  const player: EventPlayer = { x: at.x, y: at.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 };
  const obs = (): Observer => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 14 });
  sim.prefill(obs());
  for (let i = 0; i < 60; i++) sim.step(STEP, obs());
  // L'écran : un cône de ±50° devant le regard, jusqu'à 120 m (sans les murs : suffisant ici).
  const visible = (x: number, y: number): boolean => {
    const a = Math.atan2(x - player.x, y - player.y) - player.yaw;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.87 && Math.hypot(x - player.x, y - player.y) < 120;
  };
  const ctx: EventContext = { dt: STEP, player, visible, policeNear: () => false, lineClear: (x0, y0, x1, y1) => colliders.raycast(x0, y0, x1, y1) === null };
  return { sim, player, ctx, obs };
}

/** Lance un vol (en essayant quelques regards jusqu'à trouver un lieu) ; null s'il n'y en a pas. */
function start(seed: number, log: Log): { ev: SnatchEvent; sim: PedSim; player: EventPlayer; ctx: EventContext; obs: () => Observer } | null {
  const w = world(seed);
  const rng = new EventRng(seed);
  for (let k = 0; k < 8; k++) {
    w.player.yaw = (k / 8) * Math.PI * 2;
    const site = findSnatchSite(w.sim, w.ctx, rng);
    if (site) return { ev: new SnatchEvent(w.sim, effects(log), site.victim, site.thief, rng), ...w };
    for (let i = 0; i < 30; i++) w.sim.step(STEP, w.obs());
  }
  return null;
}

const newLog = (): Log => ({ says: [], cries: [], earned: 0, feats: [], crimes: [] });

/** Fait avancer la scène : passants, puis l'événement ; `bot` déplace le joueur avant chaque pas. */
function run(s: NonNullable<ReturnType<typeof start>>, seconds: number, bot?: () => void, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !s.ev.done; i++) {
    bot?.();
    s.sim.step(STEP, s.obs());
    s.ev.update(s.ctx);
    if (until?.()) return;
  }
}

/** Le joueur va vers (x, y) à `v` m/s (en ligne droite). */
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
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
}

function borrowedCount(sim: PedSim): number {
  let n = 0;
  for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i] && sim.isBorrowed(i)) n++;
  return n;
}

describe("vol à l'arraché (phase 4, E1)", () => {
  it("trouve une victime avec un sac et un voleur seul, aux bonnes distances", () => {
    let found = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = world(seed);
      const site = findSnatchSite(w.sim, w.ctx, new EventRng(seed));
      if (!site) continue;
      found++;
      const v = { x: 0, y: 0 }, t = { x: 0, y: 0 };
      w.sim.position(site.victim, v);
      w.sim.position(site.thief, t);
      expect(["handbag", "shoulder"]).toContain(w.sim.recipe(site.victim).bag);
      expect(Math.hypot(v.x - w.player.x, v.y - w.player.y)).toBeGreaterThanOrEqual(SNATCH.victimNear);
      expect(Math.hypot(t.x - v.x, t.y - v.y)).toBeGreaterThanOrEqual(SNATCH.thiefNear);
      expect(Math.hypot(t.x - w.player.x, t.y - w.player.y)).toBeGreaterThanOrEqual(SNATCH.thiefFromPlayer);
      expect(w.sim.recipe(site.thief).age).toBe("adult");
    }
    expect(found).toBeGreaterThanOrEqual(4);
  });

  it("sans police à 60 m seulement, et pas quand le joueur file en voiture", () => {
    const w = world(3);
    expect(findSnatchSite(w.sim, { ...w.ctx, policeNear: () => true }, new EventRng(1))).toBeNull();
    expect(findSnatchSite(w.sim, { ...w.ctx, player: { ...w.player, onFoot: false, speed: 12 } }, new EventRng(1))).toBeNull();
  });

  it("le voleur rejoint la victime et lui arrache son sac : elle crie, tombe ou trébuche ; s'il n'est pas poursuivi, il s'échappe et tout est rendu à la foule", () => {
    let snatched = 0, escaped = 0, tried = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      tried++;
      const bag = s.sim.recipe(s.ev.victim).bag;
      run(s, SNATCH.approachTimeout + 1, undefined, () => s.ev.phase !== "approach");
      if (s.ev.phase !== "flee") continue;
      snatched++;
      expect(s.sim.recipe(s.ev.victim).bag).toBe("none");
      expect(s.sim.recipe(s.ev.thief).bag).toBe(bag);
      expect(log.cries).toContain("scream");
      expect(log.says).toContain("Au voleur !");
      expect([PED_STATE.stumble, PED_STATE.down]).toContain(s.sim.modeOf(s.ev.victim));
      expect(s.ev.lawfulTarget(s.ev.thief)).toBe(true);
      expect(s.ev.lawfulTarget(s.ev.victim)).toBe(false);
      // Le joueur reste là : le voleur s'enfuit.
      run(s, 120);
      if (s.ev.outcome === "enfui") escaped++;
      expect(s.ev.done).toBe(true);
      expect(borrowedCount(s.sim)).toBe(0);
    }
    expect(tried).toBeGreaterThanOrEqual(6);
    expect(snatched).toBeGreaterThanOrEqual(Math.ceil(tried * 0.6));
    expect(escaped).toBe(snatched);
  });

  it("rattrapé en sprint : plaqué, il lâche le sac ; ramassé et rendu à la victime, prime ; personne ne reste réquisitionné", () => {
    let caught = 0, returned = 0, snatched = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      run(s, SNATCH.approachTimeout + 1, undefined, () => s.ev.phase !== "approach");
      if (s.ev.phase !== "flee") continue;
      snatched++;
      const t = { x: 0, y: 0 };
      // Le joueur sprinte (7 m/s) droit sur le voleur.
      run(s, 60, () => {
        s.sim.position(s.ev.thief, t);
        moveTo(s.player, t.x, t.y, 7);
      }, () => s.ev.phase !== "flee");
      if ((s.ev.phase as string) !== "bag") continue;
      caught++;
      expect(log.feats).toContain("Voleur rattrapé");
      expect(s.sim.recipe(s.ev.thief).bag).toBe("none");
      // Il va au sac, puis à la victime.
      run(s, 20, () => moveTo(s.player, s.ev.bagAt.x, s.ev.bagAt.y, 5), () => s.ev.phase === "carried");
      expect(s.ev.phase).toBe("carried");
      const v = { x: 0, y: 0 };
      let act = null;
      run(s, 80, () => {
        s.sim.position(s.ev.victim, v);
        moveTo(s.player, v.x, v.y, 5);
      }, () => {
        act = s.ev.action(s.player);
        return act?.label === "Rendre le sac";
      });
      if (act === null || (act as { label: string }).label !== "Rendre le sac") continue;
      (act as { run(): void }).run();
      returned++;
      expect(s.ev.outcome).toBe("rendu");
      expect(s.ev.goodDeed).toBe(true);
      expect(log.earned).toBe(s.ev.reward);
      expect(log.earned).toBeGreaterThanOrEqual(SNATCH.reward[0]);
      expect(s.sim.recipe(s.ev.victim).bag).not.toBe("none");
      for (let i = 0; i < 60 * 20; i++) s.sim.step(STEP, s.obs());
      expect(borrowedCount(s.sim)).toBe(0);
    }
    expect(snatched).toBeGreaterThanOrEqual(4);
    expect(caught).toBeGreaterThanOrEqual(Math.ceil(snatched * 0.75));
    expect(returned).toBeGreaterThanOrEqual(Math.ceil(caught * 0.75));
  });

  it("le sac gardé : son contenu, et un vol signalé si un passant le voit", () => {
    let kept = 0;
    for (let seed = 1; seed <= 8 && kept < 2; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      run(s, SNATCH.approachTimeout + 1, undefined, () => s.ev.phase !== "approach");
      if (s.ev.phase !== "flee") continue;
      const t = { x: 0, y: 0 };
      run(s, 60, () => {
        s.sim.position(s.ev.thief, t);
        moveTo(s.player, t.x, t.y, 7);
      }, () => s.ev.phase !== "flee");
      if ((s.ev.phase as string) !== "bag") continue;
      run(s, 20, () => moveTo(s.player, s.ev.bagAt.x, s.ev.bagAt.y, 5), () => s.ev.phase === "carried");
      const act = s.ev.action(s.player);
      expect(act?.label).toBe("Fouiller le sac");
      act!.run();
      kept++;
      expect(s.ev.outcome).toBe("garde");
      expect(log.earned).toBe(s.ev.content);
      // Le voleur se relève à côté : il y a toujours un témoin à 25 m dans le centre.
      expect(log.crimes).toContain("robbery");
    }
    expect(kept).toBeGreaterThanOrEqual(1);
  });

  it("arrêté tout de suite (mort, arrestation) : tous les figurants sont rendus", () => {
    const log = newLog();
    const s = start(2, log)!;
    run(s, 3);
    expect(borrowedCount(s.sim)).toBe(2);
    s.ev.abort();
    expect(s.ev.done).toBe(true);
    expect(borrowedCount(s.sim)).toBe(0);
  });
});
