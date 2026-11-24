import { describe, expect, it } from "vitest";
import { crowdMurmur, footingAt, footingPolys } from "./footing";

const square = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

describe("sol sous les pieds (D313)", () => {
  const tile = footingPolys({
    lawn: [[square(0, 0, 100, 100), square(40, 40, 60, 60)]],
    path_gravel: [[square(0, 45, 100, 55)]],
    road_asphalt: [[square(200, 0, 300, 100)]],
    golf_green: [[square(400, 0, 420, 20)]],
    golf_path: [[square(430, 0, 440, 20)]],
  });

  it("herbe, trou dans la pelouse, chemin de gravier posé dessus, enrobé et golf", () => {
    expect(footingAt([tile], 10, 10)).toBe("grass");
    expect(footingAt([tile], 50, 42)).toBe("hard");
    expect(footingAt([tile], 10, 50)).toBe("gravel");
    expect(footingAt([tile], 50, 50)).toBe("gravel");
    expect(footingAt([tile], 250, 50)).toBe("hard");
    expect(footingAt([tile], 410, 10)).toBe("grass");
    expect(footingAt([tile], 435, 10)).toBe("hard");
    expect(footingAt([], 10, 10)).toBe("hard");
  });

  it("brouhaha selon le nombre de passants proches", () => {
    expect(crowdMurmur(0)).toBe(0);
    expect(crowdMurmur(2)).toBe(0);
    expect(crowdMurmur(9)).toBeGreaterThan(0.2);
    expect(crowdMurmur(40)).toBeCloseTo(0.65);
  });
});
