import { describe, expect, it } from "vitest";
import { AimAssist, AIM_ASSIST, type AimAssistInput } from "./aim-assist";
import type { ShootWorld } from "./gun";

const DT = 1 / 60;

interface Body { x: number; y: number; z?: number; h?: number }

/** Des passants immobiles et, au besoin, un mur à y = `wallY` entre le tireur et eux. */
function world(bodies: Body[], wallY: number | null = null): ShootWorld {
  return {
    pick(x, y, heading, range, half, max, out) {
      out.length = 0;
      bodies.forEach((b, i) => {
        const d = Math.hypot(b.x - x, b.y - y);
        const da = Math.abs(((Math.atan2(b.x - x, b.y - y) - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d <= range && da <= half && out.length < max) out.push(i);
      });
      return out.length;
    },
    position: (i, out) => Object.assign(out, { x: bodies[i]!.x, y: bodies[i]!.y }),
    span: (i, out) => Object.assign(out, { z: bodies[i]!.z ?? 0, h: bodies[i]!.h ?? 1.75 }),
    hurt: () => 0,
    rayPed: (_x, _y, _dx, _dy, m, out) => Object.assign(out, { slot: -1, dist: m }).slot >= 0,
    wall: (_ax, ay, _bx, by) => (wallY !== null && ay < wallY && by > wallY ? (wallY - ay) / (by - ay) : null),
  };
}

/** Caméra à 1,6 m derrière et 1,6 m au-dessus de (0, 0), regard vers le nord (cap 0) et vers la poitrine d'un passant à 20 m (inclinaison ≈ 0,012). */
const input = (over: Partial<AimAssistInput> = {}): AimAssistInput => ({
  cx: 0, cy: -1.6, cz: 1.6, yaw: 0, pitch: Math.atan2(1.6 - 1.19, 21.6), dYaw: 0, dPitch: 0, x: 0, y: 0, speed: 0, range: 35, ...over,
});

describe("aide à la visée (D206)", () => {
  it("sans cible, ou réglée sur Aucune, le geste passe tel quel", () => {
    const a = new AimAssist();
    a.step(DT, 1, input({ dYaw: 0.02, dPitch: -0.01 }), world([]));
    expect([a.dYaw, a.dPitch, a.target]).toEqual([0.02, -0.01, -1]);
    a.step(DT, 0, input({ dYaw: 0.02 }), world([{ x: 0, y: 20 }]));
    expect([a.dYaw, a.target]).toEqual([0.02, -1]);
  });

  it("sur une cible, le viseur colle : le geste est freiné, davantage en Forte qu'en Légère", () => {
    const w = world([{ x: 0, y: 20 }]);
    const light = new AimAssist().step(DT, 1, input({ dYaw: 0.02 }), w);
    const strong = new AimAssist().step(DT, 2, input({ dYaw: 0.02 }), w);
    expect(light.target).toBe(0);
    expect(light.weight).toBeGreaterThan(0.9);
    // Freinage presque total au centre (35 % et 55 %), puis un peu d'attraction (vers la cible, en sens contraire du geste).
    expect(light.dYaw).toBeLessThan(0.02 * (1 - AIM_ASSIST[1]!.friction) + 1e-9);
    expect(strong.dYaw).toBeLessThan(light.dYaw);
    expect(strong.dYaw).toBeGreaterThan(0);
  });

  it("près d'une cible, on est attiré vers sa poitrine quand on tourne ou qu'on marche, jamais tout seul, et sans la dépasser", () => {
    const w = world([{ x: 1, y: 20 }]);
    const want = Math.atan2(1, 21.6);
    // Immobile, sans geste : rien ne bouge.
    const idle = new AimAssist().step(DT, 2, input(), w);
    expect(idle.target).toBe(0);
    expect(idle.dYaw).toBe(0);
    // En marchant, sans geste : le regard glisse vers la cible, sans jamais la dépasser.
    let yaw = 0;
    const a = new AimAssist();
    for (let k = 0; k < 240; k++) yaw += a.step(DT, 2, input({ yaw, speed: 1.2 }), w).dYaw;
    expect(yaw).toBeGreaterThan(want * 0.9);
    expect(yaw).toBeLessThanOrEqual(want + 1e-6);
    // Avec un petit geste dans l'autre sens, l'attraction l'emporte près de la cible, sans la retourner au-delà.
    const b = new AimAssist().step(DT, 2, input({ dYaw: -0.0005 }), w);
    expect(b.dYaw).toBeGreaterThan(-0.0005);
  });

  it("vise la poitrine, pas la tête : regard sur la tête, l'aide le ramène vers le bas en tournant", () => {
    const w = world([{ x: 0, y: 20 }]);
    const head = Math.atan2(1.6 - 1.65, 21.6);
    const a = new AimAssist().step(DT, 2, input({ pitch: head, dYaw: 0.001 }), w);
    expect(a.target).toBe(0);
    expect(a.dPitch).toBeGreaterThan(0);
  });

  it("hors de la zone ou derrière un mur, pas d'aide ; la plus proche du viseur est choisie", () => {
    const far = new AimAssist().step(DT, 2, input({ dYaw: 0.02 }), world([{ x: 8, y: 20 }]));
    expect(far.target).toBe(-1);
    expect(far.dYaw).toBe(0.02);
    const hidden = new AimAssist().step(DT, 2, input({ dYaw: 0.02 }), world([{ x: 0, y: 20 }], 10));
    expect(hidden.target).toBe(-1);
    const two = new AimAssist().step(DT, 2, input({ dYaw: 0.02 }), world([{ x: 1.5, y: 12 }, { x: 0.2, y: 20 }]));
    expect(two.target).toBe(1);
  });
});
