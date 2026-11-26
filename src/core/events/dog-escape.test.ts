import { describe, expect, it } from "vitest";
import { NavGraph } from "../nav-graph";
import { PedSim, type Observer } from "../pedestrians";
import { loadRealNav, loadRealWorld } from "../testing";
import { buildColliders } from "../world";
import { DOG_ESCAPE, DogEscapeEvent, findDogOwner, type DogEffects } from "./dog-escape";
import { SimDogs } from "./sim-dogs";
import { EventRng, type EventContext, type EventPlayer } from "./types";

const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;

interface Log {
  says: string[];
  feats: string[];
  earned: number;
  barks: number;
}

const effects = (log: Log): DogEffects => ({
  say: (_s, t) => log.says.push(t),
  cry: () => {},
  earn: (n) => (log.earned += n),
  feat: (t) => log.feats.push(t),
  crime: () => {},
  bark: () => log.barks++,
});

/** La foule avec vie de quartier (les chiens en laisse, D199) ; un joueur au centre. */
function setup(seed: number): { sim: PedSim; dogs: SimDogs; player: EventPlayer; ctx: EventContext; obs: () => Observer } {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  const sim = new PedSim(g, terrain, colliders, { capacity: 150, seed, life: true });
  const dogs = new SimDogs(sim);
  const player: EventPlayer = { x: 0, y: -20, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 };
  const obs = (): Observer => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 11 });
  sim.prefill(obs());
  for (let i = 0; i < 120; i++) {
    sim.step(STEP, obs());
    dogs.step(STEP);
  }
  const ctx: EventContext = { dt: STEP, player, visible: () => true, policeNear: () => false, lineClear: (x0, y0, x1, y1) => colliders.raycast(x0, y0, x1, y1) === null };
  return { sim, dogs, player, ctx, obs };
}

function start(seed: number, log: Log): (ReturnType<typeof setup> & { ev: DogEscapeEvent }) | null {
  const s = setup(seed);
  // Le joueur se met à 40 m d'un promeneur (s'il y en a un).
  let owner = -1;
  s.dogs.owners((slot, x, y) => {
    if (owner < 0) {
      owner = slot;
      s.player.x = x + 30;
      s.player.y = y + 25;
    }
  });
  if (owner < 0) return null;
  const slot = findDogOwner(s.sim, s.dogs, s.ctx, new EventRng(seed));
  if (slot < 0) return null;
  const dog = s.dogs.detach(slot);
  if (!dog) return null;
  return { ...s, ev: new DogEscapeEvent(s.sim, s.dogs, effects(log), slot, dog, new EventRng(seed)) };
}

function run(s: NonNullable<ReturnType<typeof start>>, seconds: number, bot?: () => void, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !s.ev.done; i++) {
    bot?.();
    s.sim.step(STEP, s.obs());
    s.dogs.step(STEP);
    s.ev.update(s.ctx);
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
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
}

const newLog = (): Log => ({ says: [], feats: [], earned: 0, barks: 0 });

describe("chien échappé (phase 4, E3)", () => {
  it("le chien part, aboie, son maître lui court après en criant son nom ; sans le joueur, le maître renonce et le chien se sauve", () => {
    let tried = 0, fled = 0;
    for (let seed = 1; seed <= 10 && tried < 3; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      tried++;
      const d0 = { x: s.ev.dog.x, y: s.ev.dog.y };
      run(s, 4);
      expect(log.barks).toBeGreaterThan(0);
      expect(log.says).toContain(`${s.ev.name} !`);
      // Il a filé au galop.
      expect(Math.hypot(s.ev.dog.x - d0.x, s.ev.dog.y - d0.y)).toBeGreaterThan(8);
      expect(s.sim.isBorrowed(s.ev.owner)).toBe(true);
      run(s, DOG_ESCAPE.ownerGivesUp + 120);
      if (s.ev.outcome === "enfui" || s.ev.outcome === "perdu") fled++;
      expect(s.ev.done).toBe(true);
      expect(s.sim.isBorrowed(s.ev.owner)).toBe(false);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(fled).toBe(tried);
  });

  it("couru après, il détale ; approché au pas, on l'attrape, on le ramène en laisse : « Merci ! », 60 à 120 €", () => {
    let caught = 0, returned = 0, tried = 0;
    for (let seed = 1; seed <= 12 && tried < 4; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      tried++;
      run(s, 3);
      // On lui court dessus : il détale (il s'éloigne plus vite qu'au trot).
      const d = s.ev.dog;
      const before = Math.hypot(d.x - s.player.x, d.y - s.player.y);
      run(s, 2, () => moveTo(s.player, d.x, d.y, 5));
      // Puis on l'approche au pas, jusqu'à pouvoir l'attraper.
      let act = null as ReturnType<DogEscapeEvent["action"]>;
      run(s, 90, () => moveTo(s.player, d.x, d.y, 1.6), () => (act = s.ev.action(s.player))?.verb === "Attraper");
      expect(before).toBeGreaterThan(0);
      if (act?.verb !== "Attraper") continue;
      act.run();
      caught++;
      expect(s.ev.phase).toBe("led");
      // En laisse, il suit le joueur jusqu'à son maître.
      const o = { x: 0, y: 0 };
      run(s, 120, () => {
        s.sim.position(s.ev.owner, o);
        moveTo(s.player, o.x, o.y, 1.6);
        expect(Math.hypot(d.x - s.player.x, d.y - s.player.y)).toBeLessThanOrEqual(2.05);
      }, () => (act = s.ev.action(s.player))?.verb === "Rendre");
      if ((act as { verb: string } | null)?.verb !== "Rendre") continue;
      act.run();
      returned++;
      expect(s.ev.outcome).toBe("rendu");
      expect(s.ev.goodDeed).toBe(true);
      expect(log.earned).toBe(s.ev.reward);
      expect(log.earned).toBeGreaterThanOrEqual(DOG_ESCAPE.reward[0]);
      expect(log.says).toContain("Merci !");
      // Le chien est de nouveau en laisse avec son maître.
      s.dogs.step(STEP);
      expect(s.dogs.dogs.includes(d)).toBe(true);
      expect(s.sim.isBorrowed(s.ev.owner)).toBe(false);
    }
    expect(tried).toBeGreaterThanOrEqual(3);
    expect(caught).toBeGreaterThanOrEqual(Math.ceil(tried * 0.6));
    expect(returned).toBeGreaterThanOrEqual(Math.ceil(caught * 0.6));
  });

  it("une voiture qui le frôle l'effraie pour de bon ; il n'est jamais tué", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const log = newLog();
      const s = start(seed, log);
      if (!s) continue;
      run(s, 2);
      const d = s.ev.dog;
      s.player.onFoot = false;
      s.player.x = d.x + 1;
      s.player.y = d.y;
      s.player.speed = 8;
      run(s, 0.1);
      expect(s.ev.phase === "gone" || s.ev.done).toBe(true);
      run(s, 60, () => (s.player.speed = 0));
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("perdu");
      return;
    }
    throw new Error("aucun promeneur trouvé");
  });
});
