import { describe, expect, it } from "vitest";
import { arcPoints, GRENADE, stepGrenade, throwVelocity, type GrenadeBody, type GrenadeWorld } from "./grenade";

const flat: GrenadeWorld = { ground: () => 0, wall: () => null };

describe("grenades (D326)", () => {
  it("lancée devant soi : environ 20 m sur le plat, plus loin en regardant plus haut, jamais vers le bas", () => {
    const pts: number[] = [];
    const far = (pitch: number): number => {
      arcPoints(0, 0, GRENADE.hand, throwVelocity(0, pitch), flat, pts, 0.02, 400);
      return pts[pts.length - 2]!;
    };
    expect(far(0)).toBeGreaterThan(16);
    expect(far(0)).toBeLessThan(26);
    expect(far(-0.3)).toBeGreaterThan(far(0.3));
    expect(throwVelocity(0, 2).vz).toBeGreaterThan(0);
    // Vers l'est (cap π/2) : x augmente, y ne bouge pas.
    const v = throwVelocity(Math.PI / 2, 0);
    expect(v.vx).toBeGreaterThan(10);
    expect(Math.abs(v.vy)).toBeLessThan(1e-9);
  });

  it("elle rebondit, roule, s'arrête ; un mur la renvoie en arrière", () => {
    const g: GrenadeBody = { x: 0, y: 0, z: 1.6, ...throwVelocity(0, 0), t: 0 };
    for (let i = 0; i < 60 * GRENADE.fuse; i++) stepGrenade(g, 1 / 60, flat);
    expect(g.z).toBe(0);
    expect(Math.hypot(g.vx, g.vy)).toBeLessThan(2);
    expect(g.t).toBeCloseTo(GRENADE.fuse, 5);
    const wall: GrenadeWorld = { ground: () => 0, wall: (_x0, y0, _x1, y1) => (y1 > 5 && y0 <= 5 ? (5 - y0) / (y1 - y0) : null) };
    const h: GrenadeBody = { x: 0, y: 0, z: 1.6, vx: 0, vy: 12, vz: 2, t: 0 };
    for (let i = 0; i < 120; i++) stepGrenade(h, 1 / 60, wall);
    expect(h.y).toBeLessThan(5);
    expect(h.vy).toBeLessThanOrEqual(0);
  });

  it("l'arc s'arrête au premier contact", () => {
    const pts: number[] = [];
    arcPoints(0, 0, 1.6, throwVelocity(0, 0.2), flat, pts);
    expect(pts.length % 3).toBe(0);
    expect(pts[pts.length - 1]).toBe(0);
    for (let i = 2; i < pts.length - 3; i += 3) expect(pts[i]!).toBeGreaterThan(0);
  });
});
