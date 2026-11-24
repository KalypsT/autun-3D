import { describe, expect, it } from "vitest";
import { DriftTracker, featLabel, JumpTracker, JUMP_SHOW, slipAngle, SLOWMO_SCALE, TimeScale } from "./feats";
import { parseRecords, RecordBook, recordText, RECORDS_KEY } from "./records";

const DT = 1 / 60;

/** Un saut balistique : décollage à (0, 0, 0), vitesse horizontale `v` (m/s), verticale `vz` ; sol plat à 0. */
function flyJump(t: JumpTracker, v: number, vz: number): { result: ReturnType<JumpTracker["update"]>; slow: number } {
  let x = 0, z = 0.3, w = vz, slow = 0;
  for (let i = 0; i < 2000; i++) {
    const res = t.update(z > 0.25, x, 0, z, 0, v, 0, w, DT);
    if (res) return { result: res, slow };
    if (t.slowmo) slow += DT;
    x += v * DT;
    z += w * DT;
    w -= 7.4 * DT;
    if (z <= 0) z = 0;
  }
  return { result: null, slow };
}

describe("sauts en véhicule (D311)", () => {
  it("mesure un grand saut et demande le ralenti pendant le vol", () => {
    const { result, slow } = flyJump(new JumpTracker(), 25, 6);
    expect(result).not.toBeNull();
    expect(result!.distance).toBeGreaterThan(JUMP_SHOW);
    expect(slow).toBeGreaterThan(0.2);
  });

  it("pas de ralenti ni de saut pour une bosse", () => {
    const { result, slow } = flyJump(new JumpTracker(), 10, 1.2);
    expect(slow).toBe(0);
    expect(result === null || result.distance < JUMP_SHOW).toBe(true);
  });
});

describe("dérapages (D311)", () => {
  it("angle de glisse entre le cap et la vitesse", () => {
    expect(slipAngle(0, 0, 10)).toBeCloseTo(0);
    expect(slipAngle(0, 10, 10)).toBeCloseTo(Math.PI / 4);
    expect(slipAngle(Math.PI / 2, 0, 10)).toBeCloseTo(Math.PI / 2);
  });

  it("compte la longueur d'un dérapage et le rend à la fin, une correction brève ne le coupe pas", () => {
    const d = new DriftTracker();
    let res = null;
    for (let i = 0; i < 120; i++) res = d.update(0.5, 15, true, DT) ?? res;
    expect(res).toBeNull();
    expect(d.drifting).toBe(true);
    for (let i = 0; i < 10; i++) d.update(0.1, 15, true, DT);
    expect(d.drifting).toBe(true);
    for (let i = 0; i < 60 && !res; i++) res = d.update(0.05, 15, true, DT);
    expect(res!.distance).toBeGreaterThan(30);
    expect(res!.angle).toBeCloseTo(0.5);
  });

  it("rien à basse vitesse ni en l'air", () => {
    const d = new DriftTracker();
    for (let i = 0; i < 60; i++) d.update(0.6, 4, true, DT);
    expect(d.drifting).toBe(false);
    for (let i = 0; i < 60; i++) d.update(0.6, 20, false, DT);
    expect(d.drifting).toBe(false);
  });
});

describe("temps du jeu (D311)", () => {
  it("arrêt sur image puis retour, ralenti seulement s'il est permis", () => {
    const t = new TimeScale();
    t.hitStop();
    expect(t.update(DT, false)).toBeLessThan(0.1);
    for (let i = 0; i < 10; i++) t.update(DT, false);
    expect(t.update(DT, false)).toBe(1);
    for (let i = 0; i < 60; i++) t.update(DT, true);
    expect(t.update(DT, true)).toBeCloseTo(SLOWMO_SCALE, 2);
    t.slowmoEnabled = false;
    for (let i = 0; i < 60; i++) t.update(DT, true);
    expect(t.update(DT, true)).toBe(1);
  });

  it("bandeaux", () => {
    expect(featLabel("jump", 34.4, false)).toBe("Saut 34 m");
    expect(featLabel("drift", 42, true)).toBe("Dérapage 42 m · record !");
  });
});

describe("carnet de records (D312)", () => {
  const memory = (): { store: Map<string, string>; s: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } } => {
    const store = new Map<string, string>();
    return { store, s: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } };
  };

  it("garde le meilleur, cumule les distances, n'annonce un record que s'il en bat un", () => {
    const { store, s } = memory();
    const b = new RecordBook(s);
    expect(b.offer("jump", 20)).toBe(false);
    expect(b.offer("jump", 18)).toBe(false);
    expect(b.offer("jump", 25)).toBe(true);
    b.add("foot", 120);
    b.add("foot", 30);
    expect(b.values.foot).toBe(150);
    expect(b.offer("foot", 1000)).toBe(false);
    b.flush();
    const again = new RecordBook(s);
    expect(again.values.jump).toBe(25);
    expect(again.values.foot).toBe(150);
    expect(JSON.parse(store.get(RECORDS_KEY)!)).toEqual({ jump: 25, foot: 150 });
  });

  it("lit avec méfiance et écrit lisiblement", () => {
    expect(parseRecords("{pas du json").jump).toBe(0);
    expect(parseRecords('{"jump": -3, "drift": "x", "wheelie": 12}')).toMatchObject({ jump: 0, drift: 0, wheelie: 12 });
    expect(recordText("topSpeed", 50)).toBe("180 km/h");
    expect(recordText("stars5", 95)).toBe("1 min 35 s");
    expect(recordText("vehicle", 12345)).toBe("12,3 km");
    expect(recordText("jump", 0)).toBe("—");
  });
});
