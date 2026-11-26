import { describe, expect, it } from "vitest";
import { JOJO, MEET_RADIUS, parseStory, Prologue, STORY_TEXT, type StoryAction } from "./story";

/** Fait avancer le prologue de `seconds` par pas de 0,1 s, le joueur en (x, y) ; rend toutes les actions demandées. */
const run = (p: Prologue, seconds: number, x = 0, y = -500): StoryAction[] => {
  const out: StoryAction[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.1) out.push(...p.update(0.1, x, y));
  return out;
};
const kinds = (a: StoryAction[]): string[] => a.map((x) => x.kind);

describe("prologue « Le retour » (D338)", () => {
  it("état enregistré lu avec méfiance : seulement une étape connue", () => {
    expect(parseStory({ step: "rejoindre" })).toEqual({ step: "rejoindre" });
    expect(parseStory({ step: "fin", autre: 1 })).toEqual({ step: "fin" });
    for (const bad of [null, 3, "fin", {}, { step: "mission-7" }, { step: 2 }]) expect(parseStory(bad)).toBeNull();
  });

  it("nouvelle partie : rien pendant la cinématique ; à sa fin, une sauvegarde, puis le SMS de Jojo, l'objectif et le repère", () => {
    const p = new Prologue(null, true);
    expect(p.step).toBe("arrivee");
    expect(run(p, 30)).toEqual([]);
    expect(p.introDone()).toEqual([{ kind: "save" }]);
    expect(p.step).toBe("rejoindre");
    expect(run(p, 7)).toEqual([]);
    const a = run(p, 2);
    expect(a).toEqual([
      { kind: "sms", from: "Jojo", text: STORY_TEXT.sms },
      { kind: "objective", text: STORY_TEXT.objective },
      { kind: "waypoint", at: { x: JOJO.x, y: JOJO.y } },
      { kind: "save" },
    ]);
    // Une seule fois.
    expect(run(p, 30)).toEqual([]);
    expect(p.introDone()).toEqual([]);
  });

  it("près de Jojo : le repère s'efface, trois répliques, puis le bandeau de fin et une sauvegarde ; Jojo s'en va ensuite", () => {
    const p = new Prologue(null, true);
    p.introDone();
    run(p, 10);
    // Encore trop loin.
    expect(run(p, 1, JOJO.x + MEET_RADIUS + 0.5, JOJO.y)).toEqual([]);
    const a = run(p, 14, JOJO.x + 2, JOJO.y);
    expect(kinds(a)).toEqual(["waypoint", "say", "say", "say", "banner", "save"]);
    expect(a[0]).toEqual({ kind: "waypoint", at: null });
    expect(a.filter((x) => x.kind === "say").map((x) => (x as { text: string }).text)).toEqual([...STORY_TEXT.lines]);
    expect(a[4]).toEqual({ kind: "banner", ...STORY_TEXT.end });
    expect(p.step).toBe("fin");
    expect(p.toSave()).toEqual({ step: "fin" });
    expect(p.jojoHere).toBe(true);
    run(p, 25, JOJO.x + 2, JOJO.y);
    expect(p.jojoHere).toBe(false);
  });

  it("Jojo n'écrit pas avant la fin de la cinématique, même si le joueur passe devant le café", () => {
    const p = new Prologue(null, true);
    expect(run(p, 5, JOJO.x, JOJO.y)).toEqual([]);
  });

  it("partie reprise à l'étape « rejoindre » : objectif et repère tout de suite, sans SMS ; reprise pendant la cinématique : même chose", () => {
    for (const step of ["rejoindre", "arrivee"] as const) {
      const p = new Prologue({ step }, false);
      expect(p.step).toBe("rejoindre");
      expect(kinds(run(p, 0.1))).toEqual(["objective", "waypoint"]);
      expect(run(p, 20)).toEqual([]);
    }
  });

  it("partie d'avant l'histoire (sauvegarde sans `story`) : prologue terminé, pas de Jojo ; partie finie : rien", () => {
    for (const p of [new Prologue(null, false), new Prologue({ step: "fin" }, false)]) {
      expect(p.step).toBe("fin");
      expect(p.jojoHere).toBe(false);
      expect(run(p, 20, JOJO.x, JOJO.y)).toEqual([]);
    }
  });
});
