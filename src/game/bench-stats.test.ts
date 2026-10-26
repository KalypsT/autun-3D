import { describe, expect, it } from "vitest";
import { BENCH_ROUTE } from "./bench-route";
import { Polyline, summarizeFrames } from "./bench-stats";

describe("summarizeFrames", () => {
  it("60 i/s réguliers", () => {
    const s = summarizeFrames(Array<number>(600).fill(1000 / 60));
    expect(s.fps).toBeCloseTo(60, 5);
    expect(s.low1).toBeCloseTo(60, 5);
    expect(s.over33).toBe(0);
    expect(s.seconds).toBeCloseTo(10, 5);
  });

  it("les à-coups pèsent sur le 1 % lent, pas sur la moyenne", () => {
    const ms = Array<number>(198).fill(16).concat([120, 80]);
    const s = summarizeFrames(ms);
    expect(s.fps).toBeGreaterThan(55);
    expect(s.low1).toBeCloseTo(1000 / 100, 5);
    expect(s.max).toBe(120);
    expect(s.over50).toBe(2);
    expect(s.p50).toBe(16);
  });

  it("aucune image", () => {
    expect(summarizeFrames([]).fps).toBe(0);
  });
});

describe("Polyline", () => {
  it("abscisse curviligne et bornes", () => {
    const p = new Polyline([0, 0, 10, 0, 10, 5]);
    expect(p.length).toBe(15);
    expect(p.at(5)).toEqual({ x: 5, y: 0 });
    expect(p.at(12)).toEqual({ x: 10, y: 2 });
    expect(p.at(-1)).toEqual({ x: 0, y: 0 });
    expect(p.at(99)).toEqual({ x: 10, y: 5 });
  });

  it("le parcours du banc reste dans la zone et sans saut", () => {
    const p = new Polyline(BENCH_ROUTE);
    expect(p.length).toBeGreaterThan(2000);
    for (let i = 0; i < BENCH_ROUTE.length; i += 2) {
      expect(BENCH_ROUTE[i]).toBeGreaterThan(-520);
      expect(BENCH_ROUTE[i]).toBeLessThan(980);
      expect(BENCH_ROUTE[i + 1]).toBeGreaterThan(-812);
      expect(BENCH_ROUTE[i + 1]).toBeLessThan(688);
      if (i > 0) expect(Math.hypot(BENCH_ROUTE[i]! - BENCH_ROUTE[i - 2]!, BENCH_ROUTE[i + 1]! - BENCH_ROUTE[i - 1]!)).toBeLessThan(120);
    }
  });
});
