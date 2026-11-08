import { describe, expect, it } from "vitest";
import { HitchProbe, hitchLines, summarizeLoaf, type LoafEntry } from "./bench-hitches";

describe("images lentes du banc (D284)", () => {
  it("garde l'image précédente quand elle est lente, avec le temps de chaque partie", () => {
    let now = 0;
    const probe = new HitchProbe(() => now);
    probe.reset();
    // Image 1 : 2 ms de tuiles, 30 ms de rendu.
    probe.begin();
    now += 2; probe.mark("tuiles");
    now += 30; probe.mark("rendu");
    now += 8;
    // Image 2 : la durée mesurée (40 ms) est celle de l'image 1.
    probe.begin();
    probe.sample(40, 1.5);
    // Image 3 : image 2 normale, pas gardée.
    now += 16; probe.mark("rendu");
    probe.begin();
    probe.sample(16, 0);
    const r = probe.report();
    expect(r.count).toBe(1);
    expect(r.frames[0]!.sections).toEqual({ tuiles: 2, rendu: 30 });
    expect(r.frames[0]!.work).toBe(32);
    expect(r.frames[0]!.build).toBe(1.5);
    expect(r.sections).toEqual({ tuiles: 2, rendu: 30 });
    // 40 ms − 32 ms mesurés − une image normale (16,7 ms) : rien hors mesure.
    expect(r.outside).toBe(0);
    expect(hitchLines(r)[0]).toContain("rendu 30");
  });

  it("regroupe les scripts de Chrome par fonction, du plus coûteux au moins coûteux", () => {
    const script = (fn: string, ms: number) => ({ invokerType: "resolve-promise", invoker: "Response.json.then", sourceFunctionName: fn, sourceURL: "https://x/assets/index-abc.js", sourceCharPosition: 12, duration: ms });
    const e: LoafEntry[] = [
      { startTime: 0, duration: 80, blockingDuration: 30, renderStart: 70, scripts: [script("a", 40), script("b", 10)] },
      { startTime: 100, duration: 60, blockingDuration: 10, renderStart: 0, scripts: [script("a", 20)] },
    ];
    const s = summarizeLoaf(e);
    expect(s.count).toBe(2);
    expect(s.blockingMs).toBe(40);
    expect(s.renderMs).toBe(10);
    expect(s.scripts[0]).toEqual({ key: "resolve-promise · a · index-abc.js:12", ms: 60, count: 2, max: 40 });
  });
});
