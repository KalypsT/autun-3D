import { describe, expect, it } from "vitest";
import { PAN, scopePan, scopeSway, SWAY, SWAY_SETTLE, SWAY_SHOT } from "./scope";

describe("lunette (D207)", () => {
  it("le balancement reste petit au repos, plus fort juste après un tir, et revient", () => {
    const o = { yaw: 0, pitch: 0 };
    let calm = 0, shot = 0;
    for (let t = 0; t < 10; t += 0.05) {
      scopeSway(t, 10, o);
      calm = Math.max(calm, Math.hypot(o.yaw, o.pitch));
      scopeSway(t, 0, o);
      shot = Math.max(shot, Math.hypot(o.yaw, o.pitch));
    }
    expect(calm).toBeLessThanOrEqual(SWAY * 1.17);
    expect(calm).toBeGreaterThan(SWAY * 0.5);
    expect(shot).toBeCloseTo(calm * (1 + SWAY_SHOT), 3);
    scopeSway(3, SWAY_SETTLE, o);
    const settled = Math.hypot(o.yaw, o.pitch);
    scopeSway(3, 100, o);
    expect(settled).toBeCloseTo(Math.hypot(o.yaw, o.pitch), 9);
  });

  it("le joystick balaie d'autant plus lentement que la lunette grossit ; pousser vers le haut lève le regard", () => {
    const o = { yaw: 0, pitch: 0 };
    scopePan(1, 1, 5, 1, o);
    expect(o.yaw).toBeCloseTo(PAN / 5, 9);
    expect(o.pitch).toBeCloseTo(-PAN / 5, 9);
    scopePan(0.5, 0, 10, 1, o);
    expect(o.yaw).toBeCloseTo(PAN / 20, 9);
  });
});
