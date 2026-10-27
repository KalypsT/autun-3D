import { describe, expect, it } from "vitest";
import { clampToDisc, toggleWaypoint, waypointFrom } from "./waypoint";

describe("repère", () => {
  it("un appui long pose le repère, un second appui sur lui le retire", () => {
    const wp = toggleWaypoint(null, 120.04, -80.96, 15);
    expect(wp).toEqual({ x: 120, y: -81 });
    expect(toggleWaypoint(wp, 125, -85, 15)).toBeNull();
  });

  it("un appui long ailleurs déplace le repère", () => {
    expect(toggleWaypoint({ x: 0, y: 0 }, 200, 0, 15)).toEqual({ x: 200, y: 0 });
  });

  it("distance et cap vus du joueur, écart relatif à la direction regardée", () => {
    const r = waypointFrom(0, 0, { x: 30, y: 40 }, 0);
    expect(r.distance).toBeCloseTo(50);
    expect(r.bearing).toBeCloseTo(Math.atan2(30, 40));
    // Le joueur regarde plein est : un repère au nord est sur sa gauche (−90°).
    expect(waypointFrom(0, 0, { x: 0, y: 10 }, Math.PI / 2).relative).toBeCloseTo(-Math.PI / 2);
    // Écart toujours ramené entre −π et π.
    expect(Math.abs(waypointFrom(0, 0, { x: 0, y: -10 }, 3.1 + 2 * Math.PI).relative)).toBeLessThanOrEqual(Math.PI);
  });

  it("hors de la minimap, le repère est ramené sur le bord, dans sa direction", () => {
    const inside = clampToDisc(10, -20, 70);
    expect(inside.outside).toBe(false);
    expect([inside.x, inside.y]).toEqual([10, -20]);
    const out = clampToDisc(300, 0, 70);
    expect(out.outside).toBe(true);
    expect(out.x).toBeCloseTo(70);
    expect(out.y).toBeCloseTo(0);
    expect(out.angle).toBeCloseTo(Math.PI / 2);
    const up = clampToDisc(0, -500, 70);
    expect(up.y).toBeCloseTo(-70);
    expect(up.angle).toBeCloseTo(0);
  });
});
