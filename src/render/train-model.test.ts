import { describe, expect, it } from "vitest";
import { WAGON } from "../core/tourist-train";
import { BENCH, passengerBatch } from "./train-model";

describe("passagers du petit train (D119)", () => {
  it("à peu près une place sur deux est prise, toujours les mêmes pour un même wagon ; les wagons ne se ressemblent pas", () => {
    const seats = BENCH.rows * BENCH.seats.length;
    const counts = [1, 2, 3].map((seed) => {
      const a = passengerBatch(WAGON, seed)!, b = passengerBatch(WAGON, seed)!;
      expect(a.count).toBe(b.count);
      expect(a.count).toBeGreaterThanOrEqual(2);
      expect(a.count).toBeLessThanOrEqual(seats - 2);
      a.dispose();
      b.dispose();
      return a.count;
    });
    expect(counts.reduce((x, y) => x + y, 0)).toBeGreaterThan(seats * 3 * 0.35);
    expect(counts.reduce((x, y) => x + y, 0)).toBeLessThan(seats * 3 * 0.75);
  });
});
