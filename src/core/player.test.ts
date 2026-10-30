import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { Terrain } from "../data/terrain";
import type { TerrainMeta } from "../data/types";
import { dropDamage } from "./health";
import { createPlayer, JUMP_HEIGHT, RUN_SPEED, SLIDE_DECEL, slidePlayer, stepPlayer, WALK_SPEED } from "./player";
import { flatTerrain } from "./testing";

const DT = 1 / 60;
const terrain = flatTerrain();

function run(frames: number, fn: () => void): void {
  for (let i = 0; i < frames; i++) fn();
}

describe("stepPlayer", () => {
  it("accélère jusqu'à la vitesse de marche, pas au-delà", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 1, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(WALK_SPEED, 1);
    expect(p.y).toBeGreaterThan(2);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
  });

  it("court plus vite que la marche", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(RUN_SPEED, 1);
  });

  it("une demi-poussée donne une demi-vitesse", () => {
    const p = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(p, { forward: 0.5, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeCloseTo(WALK_SPEED / 2, 1);
  });

  it("s'arrête quand on lâche", () => {
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    run(60, () => stepPlayer(p, { forward: 0, right: 0, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.speed).toBeLessThan(0.01);
  });

  it("avance dans la direction de la caméra", () => {
    const p = createPlayer(0, 0, terrain);
    // Caméra tournée vers l'est (yaw 90°) : « avant » = +x.
    run(60, () => stepPlayer(p, { forward: 1, right: 0, run: false }, Math.PI / 2, DT, terrain, new Colliders()));
    expect(p.x).toBeGreaterThan(1);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
    expect(p.heading).toBeGreaterThan(1.2);
  });

  it("droite = à droite de la caméra", () => {
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, { forward: 0, right: 1, run: false }, 0, DT, terrain, new Colliders()));
    expect(p.x).toBeGreaterThan(1);
  });

  it("est arrêté par un mur", () => {
    const c = new Colliders();
    c.addSegment(5, -20, 5, 20);
    const p = createPlayer(0, 0, terrain);
    run(600, () => stepPlayer(p, { forward: 0, right: 1, run: true }, 0, DT, terrain, c));
    expect(p.x).toBeLessThanOrEqual(5 - 0.35 + 1e-3);
    expect(p.x).toBeGreaterThan(4.5);
  });

  it("glisse le long d'un mur en biais", () => {
    const c = new Colliders();
    c.addSegment(5, -50, 5, 50);
    const p = createPlayer(0, 0, terrain);
    // Direction nord-est : le mur retient l'est, le nord continue.
    run(240, () => stepPlayer(p, { forward: 1, right: 1, run: true }, 0, DT, terrain, c));
    expect(p.x).toBeLessThanOrEqual(5);
    expect(p.y).toBeGreaterThan(10);
  });

  it("suit le relief", () => {
    const hill = flatTerrain(3);
    const p = createPlayer(0, 0, hill);
    expect(p.z).toBeCloseTo(3);
  });

  it("ne sort pas du monde", () => {
    const p = createPlayer(0, 0, terrain);
    run(3000, () => stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, terrain, new Colliders()));
    expect(p.y).toBeLessThanOrEqual(terrain.yMax - 3 + 1e-6);
  });
});

describe("pilote tombé (D98)", () => {
  it("glisse dans le sens de sa vitesse et s'arrête au bout de v² / 2a, sans traverser un mur", () => {
    const t = flatTerrain();
    const p = createPlayer(0, -50, t);
    p.vy = 10;
    for (let i = 0; i < 180; i++) slidePlayer(p, 1 / 60, t, new Colliders());
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.y + 50).toBeCloseTo(100 / (2 * SLIDE_DECEL), 0);
    const wall = new Colliders();
    wall.addSegment(-10, 0, 10, 0);
    const q = createPlayer(0, -2, t);
    q.vy = 12;
    for (let i = 0; i < 120; i++) slidePlayer(q, 1 / 60, t, wall);
    expect(q.y).toBeLessThan(0);
  });
});

/** Terrain dont l'altitude ne dépend que de y (profil nord-sud). */
function profile(z: (y: number) => number): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: 0, unit: 0.01, zmin: -50, zmax: 50 } as TerrainMeta;
  const raw = new Float32Array(200 * 200);
  for (let r = 0; r < 200; r++) for (let c = 0; c < 200; c++) raw[r * 200 + c] = z(100 - r);
  return new Terrain(meta, raw);
}

describe("saut, chute et escalade", () => {
  const go = { forward: 1, right: 0, run: true };

  it("un saut monte à JUMP_HEIGHT et retombe en moins d'une seconde", () => {
    const p = createPlayer(0, 0, terrain);
    stepPlayer(p, { ...go, forward: 0, jump: true }, 0, DT, terrain, new Colliders());
    let top = 0, frames = 0;
    while (p.air && frames < 120) {
      stepPlayer(p, { ...go, forward: 0 }, 0, DT, terrain, new Colliders());
      top = Math.max(top, p.z);
      frames++;
    }
    expect(top).toBeCloseTo(JUMP_HEIGHT, 1);
    expect(frames).toBeLessThan(60);
    expect(p.z).toBe(0);
    expect(p.landed).toBeCloseTo(JUMP_HEIGHT, 1);
    expect(dropDamage(p.landed)).toBe(0);
  });

  it("passe un muret de 1 m en sautant, pas sans sauter, et jamais un mur de 2 m", () => {
    const wall = (h: number): Colliders => {
      const c = new Colliders();
      c.addSegment(-10, 2, 10, 2, true, { height: h, climb: false });
      return c;
    };
    const walk = createPlayer(0, 0, terrain);
    run(120, () => stepPlayer(walk, go, 0, DT, terrain, wall(1)));
    expect(walk.y).toBeLessThan(2);
    for (const [h, over] of [[1, true], [2, false]] as const) {
      const p = createPlayer(0, -3, terrain);
      const c = wall(h);
      run(40, () => stepPlayer(p, go, 0, DT, terrain, c));
      stepPlayer(p, { ...go, jump: true }, 0, DT, terrain, c);
      run(120, () => stepPlayer(p, go, 0, DT, terrain, c));
      expect(p.y > 2).toBe(over);
    }
  });

  it("escalade une grille de 2 m qu'on pousse en sautant, et retombe de l'autre côté", () => {
    const c = new Colliders();
    c.addSegment(-10, 2, 10, 2, true, { height: 2, climb: true });
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, go, 0, DT, terrain, c));
    stepPlayer(p, { ...go, jump: true }, 0, DT, terrain, c);
    expect(p.climb).not.toBeNull();
    let top = 0;
    run(150, () => {
      stepPlayer(p, go, 0, DT, terrain, c);
      top = Math.max(top, p.z);
    });
    expect(top).toBeGreaterThanOrEqual(2);
    expect(p.climb).toBeNull();
    expect(p.y).toBeGreaterThan(2.3);
    expect(p.z).toBe(0);
  });

  it("n'escalade pas un mur de bâtiment", () => {
    const c = new Colliders();
    c.addSegment(-10, 2, 10, 2);
    const p = createPlayer(0, 0, terrain);
    run(60, () => stepPlayer(p, go, 0, DT, terrain, c));
    stepPlayer(p, { ...go, jump: true }, 0, DT, terrain, c);
    run(120, () => stepPlayer(p, go, 0, DT, terrain, c));
    expect(p.climb).toBeNull();
    expect(p.y).toBeLessThan(2);
  });

  it("tombe du haut d'une falaise de 10 m au lieu d'en suivre la paroi, et se blesse", () => {
    const cliff = profile((y) => (y < 5 ? 10 : 0));
    const p = createPlayer(0, 0, cliff);
    let fell = false;
    run(240, () => {
      stepPlayer(p, go, 0, DT, cliff, new Colliders());
      fell ||= p.air;
      if (p.landed > 0) expect(p.landed).toBeGreaterThan(9);
    });
    expect(fell).toBe(true);
    expect(p.z).toBeCloseTo(0, 1);
    expect(dropDamage(10)).toBeGreaterThan(40);
    expect(dropDamage(3)).toBe(0);
  });

  it("descend une pente raide en courant sans décoller", () => {
    const hill = profile((y) => -0.6 * y);
    const p = createPlayer(0, -20, hill);
    run(300, () => {
      stepPlayer(p, go, 0, DT, hill, new Colliders());
      expect(p.air).toBe(false);
    });
  });
});
