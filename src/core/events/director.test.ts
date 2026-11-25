import { describe, expect, it } from "vitest";
import { DIRECTOR, EventDirector, type DirectorContext, type EventDef } from "./director";
import type { EventKind, GameEvent } from "./types";

/** Un faux événement qui dure `life` s puis finit avec l'issue « rendu ». */
function fake(kind: EventKind, life: number, big = false): GameEvent & { t: number; aborted: boolean } {
  return {
    kind, big, x: 0, y: 0, done: false, outcome: null, goodDeed: false, t: 0, aborted: false,
    update(ctx) {
      this.t += ctx.dt;
      if (this.t >= life) {
        (this as { done: boolean }).done = true;
        (this as { outcome: string }).outcome = "rendu";
      }
    },
    markers: () => {},
    items: () => {},
    action: () => null,
    lawfulTarget: () => false,
    abort() {
      this.aborted = true;
      (this as { done: boolean }).done = true;
    },
  };
}

const ctx = (over: Partial<DirectorContext> = {}): DirectorContext => ({
  dt: 0.5, player: { x: 0, y: 0, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 }, visible: () => true, policeNear: () => false,
  hour: 14, weekday: 2, rain: 0, zone: 0, stars: 0, blocked: false, crowd: true, traffic: true, ...over,
});

function director(kinds: EventKind[], life = 30, found = true): { d: EventDirector; started: EventKind[] } {
  const d = new EventDirector(7);
  const started: EventKind[] = [];
  for (const kind of kinds) {
    const def: EventDef = { kind, big: false, label: kind, weight: () => 1, start: () => (found ? (started.push(kind), fake(kind, life)) : null) };
    d.register(def);
  }
  return { d, started };
}

const runFor = (d: EventDirector, seconds: number, c = ctx()): void => {
  for (let t = 0; t < seconds; t += c.dt) d.update(c);
};

describe("directeur d'événements (phase 4)", () => {
  it("rythme « Normaux » au centre en journée : un départ toutes les quelques minutes, jamais deux à moins de 60 s", () => {
    const { d, started } = director(["vol", "pickpocket", "chien"]);
    const times: number[] = [];
    let clock = 0;
    const c = ctx();
    for (; clock < 3 * 3600; clock += c.dt) {
      const n = started.length;
      d.update(c);
      if (started.length > n) times.push(clock);
    }
    // ≈ un toutes les 3 min plus les délais (calme de départ, 60 s entre deux, 45 s après une fin) : 30 à 60 en trois heures.
    expect(times.length).toBeGreaterThan(30);
    expect(times.length).toBeLessThan(60);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(DIRECTOR.minGap);
    expect(times[0]!).toBeGreaterThanOrEqual(DIRECTOR.quiet);
  });

  it("jamais le même deux fois de suite, ni avant 8 minutes", () => {
    const { d, started } = director(["vol", "pickpocket", "chien"]);
    const at: Record<string, number> = {};
    let clock = 0, last = "";
    const c = ctx();
    for (; clock < 4 * 3600; clock += c.dt) {
      const n = started.length;
      d.update(c);
      if (started.length > n) {
        const k = started[started.length - 1]!;
        expect(k).not.toBe(last);
        if (at[k] !== undefined) expect(clock - at[k]!).toBeGreaterThanOrEqual(DIRECTOR.sameAgain);
        at[k] = clock;
        last = k;
      }
    }
  });

  it("rien avec des étoiles, quand c'est bloqué, à « Aucun », ni pendant le calme d'après un chargement ; moins en périphérie et la nuit", () => {
    for (const over of [{ stars: 1 }, { blocked: true }]) {
      const { d, started } = director(["vol", "chien"]);
      runFor(d, 3600, ctx(over));
      expect(started.length).toBe(0);
    }
    const off = director(["vol"]);
    off.d.level = 0;
    runFor(off.d, 3600);
    expect(off.started.length).toBe(0);
    const d = new EventDirector(1);
    expect(d.rate(ctx({ zone: 2 }))).toBeLessThan(d.rate(ctx()) * 0.5);
    expect(d.rate(ctx({ hour: 3 }))).toBeLessThan(d.rate(ctx()));
    d.level = 3;
    const freq = d.rate(ctx());
    d.level = 1;
    expect(d.rate(ctx())).toBeLessThan(freq / 4);
  });

  it("un départ forcé, le journal à la fin, et `clear` arrête ce qui est en cours", () => {
    const { d } = director(["vol"], 10);
    d.date = 3;
    d.hour = 15.5;
    expect(d.force("vol", ctx())).toBe(true);
    expect(d.active.length).toBe(1);
    runFor(d, 12);
    expect(d.active.length).toBe(0);
    expect(d.journal).toHaveLength(1);
    expect(d.journal[0]).toMatchObject({ kind: "vol", outcome: "rendu", date: 3 });
    const ends: { kind: string }[] = [];
    d.takeEnds(ends as never);
    expect(ends).toHaveLength(1);
    d.force("vol", ctx());
    const ev = d.active[0] as ReturnType<typeof fake>;
    d.reset();
    expect(ev.aborted).toBe(true);
    expect(d.active.length).toBe(0);
    // Un événement arrêté (pas eu lieu) ne va pas au journal.
    runFor(d, 1);
    expect(d.journal).toHaveLength(1);
  });

  it("sans lieu trouvé, rien ne démarre (et on le compte)", () => {
    const { d, started } = director(["vol"], 10, false);
    runFor(d, 1800);
    expect(started.length).toBe(0);
    expect(d.misses).toBeGreaterThan(0);
  });
});
