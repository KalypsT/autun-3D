import { describe, expect, it } from "vitest";
import { CATALOG } from "./vehicle-catalog";
import {
  ambience, assignVoices, bellStrikes, distanceCutoff, distanceGain, doppler, ENGINE_PROFILES, EngineModel, engineProfile, firingHz, stepCrossed, stereo,
} from "./sound-model";

/** Accélère à fond de 0 à `to` (m/s) en `seconds`, linéairement ; rend les rapports vus et le régime maximal. */
function accelerate(m: EngineModel, to: number, seconds: number): { gears: number[]; maxRpm: number; shifts: number } {
  const dt = 1 / 60, gears: number[] = [];
  let maxRpm = 0, shifts = 0;
  for (let t = 0; t < seconds; t += dt) {
    m.step(dt, (to * t) / seconds, 1);
    if (m.shifted) shifts++;
    if (gears[gears.length - 1] !== m.gear) gears.push(m.gear);
    maxRpm = Math.max(maxRpm, m.rpm);
  }
  return { gears, maxRpm, shifts };
}

describe("profils sonores des moteurs", () => {
  it("chaque modèle du catalogue a un profil, cohérent avec sa famille", () => {
    for (const d of CATALOG) {
      const p = ENGINE_PROFILES[d.id];
      expect(p, d.id).toBeDefined();
      if (d.family === "bike") expect(p!.kind).toBe("pedal");
      else if (d.family === "kickscooter") expect(p!.kind).toBe("electric");
      else {
        expect(p!.kind).toBe("combustion");
        expect(p!.redline).toBeGreaterThan(p!.idle * 3);
      }
    }
    expect(engineProfile("inconnu", "moto")).toBe(ENGINE_PROFILES["moto-routiere"]);
  });

  it("fréquence d'allumage : un quatre-cylindres à 3 000 tr/min donne 100 Hz", () => {
    expect(firingHz(ENGINE_PROFILES["compacte"]!, 3000)).toBeCloseTo(100);
  });
});

describe("régime moteur (boîte imaginaire)", () => {
  it("au ralenti à l'arrêt, point mort", () => {
    const m = new EngineModel(ENGINE_PROFILES["compacte"]!, 205 / 3.6);
    for (let i = 0; i < 120; i++) m.step(1 / 60, 0, 0);
    expect(m.gear).toBe(0);
    expect(m.rpm).toBeCloseTo(800, 0);
  });

  it("accélérer à l'arrêt fait monter le régime (embrayage qui patine) sans dépasser la zone rouge", () => {
    const p = ENGINE_PROFILES["compacte"]!, m = new EngineModel(p, 205 / 3.6);
    for (let i = 0; i < 60; i++) m.step(1 / 60, 0, 1);
    expect(m.rpm).toBeGreaterThan(p.idle * 2);
    expect(m.rpm).toBeLessThan(p.redline);
  });

  it("à fond jusqu'à la vitesse maximale : tous les rapports dans l'ordre, jamais au-delà de la zone rouge", () => {
    const p = ENGINE_PROFILES["compacte"]!, top = 205 / 3.6, m = new EngineModel(p, top);
    const r = accelerate(m, top * 0.98, 40);
    expect(r.gears).toEqual([1, 2, 3, 4, 5]);
    expect(r.shifts).toBe(4);
    expect(r.maxRpm).toBeLessThanOrEqual(p.redline * 1.02);
    expect(m.rpm).toBeGreaterThan(p.redline * 0.8);
  });

  it("le régime chute au passage d'un rapport, et la charge est coupée pendant ce temps", () => {
    const m = new EngineModel(ENGINE_PROFILES["compacte"]!, 205 / 3.6);
    let before = 0;
    for (let t = 0, v = 0; t < 20; t += 1 / 60) {
      v += (1 / 60) * 3;
      const rpm = m.rpm;
      m.step(1 / 60, v, 1);
      if (m.shifted && m.gear === 2) before = rpm;
      if (m.gear === 2 && m.shifting > 0 && m.shifting < 0.1) {
        expect(m.rpm).toBeLessThan(before * 0.85);
        expect(m.load).toBeLessThan(0.3);
        return;
      }
    }
    throw new Error("pas de passage en 2e");
  });

  it("en roulant tranquille, on passe les rapports plus tôt ; en ralentissant, on rétrograde", () => {
    const p = ENGINE_PROFILES["compacte"]!, top = 205 / 3.6;
    const soft = new EngineModel(p, top), hard = new EngineModel(p, top);
    for (let t = 0; t < 10; t += 1 / 60) {
      soft.step(1 / 60, 50 / 3.6, 0.25);
      hard.step(1 / 60, 50 / 3.6, 1);
    }
    expect(soft.gear).toBeGreaterThan(hard.gear);
    for (let v = 50 / 3.6; v > 8 / 3.6; v -= 0.05) soft.step(1 / 60, v, 0);
    expect(soft.gear).toBeLessThanOrEqual(2);
  });

  it("marche arrière : rapport −1", () => {
    const m = new EngineModel(ENGINE_PROFILES["citadine"]!, 160 / 3.6);
    for (let i = 0; i < 30; i++) m.step(1 / 60, -2, 0.5);
    expect(m.gear).toBe(-1);
    expect(m.rpm).toBeGreaterThan(ENGINE_PROFILES["citadine"]!.idle);
  });

  it("variateur du scooter : le régime monte d'un coup puis reste haut pendant que la vitesse grimpe", () => {
    const p = ENGINE_PROFILES["scooter-125"]!, m = new EngineModel(p, 100 / 3.6);
    for (let i = 0; i < 30; i++) m.step(1 / 60, 1, 1);
    const early = m.rpm;
    for (let i = 0; i < 30; i++) m.step(1 / 60, 15, 1);
    expect(early).toBeGreaterThan(p.redline * 0.45);
    expect(m.rpm).toBeGreaterThan(early);
    expect(m.rpm).toBeLessThanOrEqual(p.redline * 1.02);
  });

  it("vélo : cadence en pédalant, rien en roue libre ; trottinette : sifflement proportionnel à la vitesse", () => {
    const bike = new EngineModel(ENGINE_PROFILES["velo-ville"]!, 27 / 3.6);
    for (let i = 0; i < 120; i++) bike.step(1 / 60, 5, 1);
    expect(bike.rpm).toBeGreaterThan(60);
    for (let i = 0; i < 120; i++) bike.step(1 / 60, 5, 0);
    expect(bike.rpm).toBeLessThan(5);
    const kick = new EngineModel(ENGINE_PROFILES["trottinette"]!, 25 / 3.6);
    for (let i = 0; i < 120; i++) kick.step(1 / 60, 25 / 3.6 / 2, 1);
    expect(kick.rpm).toBeCloseTo(3000, -2);
  });

  it("pétarades des sportives : pied levé à haut régime seulement", () => {
    const m = new EngineModel(ENGINE_PROFILES["sportive"]!, 240 / 3.6);
    accelerate(m, 120 / 3.6, 8);
    m.step(1 / 60, 120 / 3.6, 0);
    expect(m.overrun).toBe(true);
    const calm = new EngineModel(ENGINE_PROFILES["compacte"]!, 205 / 3.6);
    accelerate(calm, 120 / 3.6, 8);
    calm.step(1 / 60, 120 / 3.6, 0);
    expect(calm.overrun).toBe(false);
  });
});

describe("espace sonore", () => {
  it("gain : plein jusqu'à la référence, décroissant, nul au-delà du maximum", () => {
    expect(distanceGain(2, 5, 100)).toBe(1);
    expect(distanceGain(10, 5, 100)).toBeCloseTo(0.5);
    let prev = 1;
    for (let d = 5; d <= 100; d += 1) {
      const g = distanceGain(d, 5, 100);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
    expect(distanceGain(100, 5, 100)).toBe(0);
    expect(distanceGain(99.9, 5, 100)).toBeLessThan(0.001);
  });

  it("les sons lointains perdent leurs aigus", () => {
    expect(distanceCutoff(0)).toBe(18000);
    expect(distanceCutoff(100)).toBeLessThan(distanceCutoff(20));
    expect(distanceCutoff(10000)).toBe(500);
  });

  it("stéréo : à droite de la caméra, à droite ; derrière, `behind` à 1", () => {
    const o = { pan: 0, behind: 0 };
    // Caméra tournée vers le nord : l'est est à droite.
    expect(stereo(0, 0, 0, 10, 0, o).pan).toBeCloseTo(0.85);
    expect(stereo(0, 0, 0, -10, 0, o).pan).toBeCloseTo(-0.85);
    expect(stereo(0, 0, 0, 0, 10, o).behind).toBe(0);
    expect(stereo(0, 0, 0, 0, -10, o).behind).toBeCloseTo(1);
    // Caméra tournée vers l'est : le sud est à droite.
    expect(stereo(0, 0, Math.PI / 2, 0, -10, o).pan).toBeCloseTo(0.85);
  });

  it("Doppler : plus aigu en approche, plus grave en s'éloignant, rien de côté", () => {
    // Source à 50 m au nord, qui vient vers l'auditeur à 30 m/s.
    expect(doppler(0, 50, 0, -30, 0, 0)).toBeGreaterThan(1.05);
    expect(doppler(0, 50, 0, 30, 0, 0)).toBeLessThan(0.95);
    expect(doppler(50, 0, 0, 30, 0, 0)).toBeCloseTo(1);
    // L'auditeur qui roule avec la source : pas d'effet.
    expect(doppler(0, 50, 0, 30, 0, 30)).toBeCloseTo(1);
  });

  it("voix : une source qui reste parmi les plus fortes garde sa voix ; une nouvelle prend la place libérée", () => {
    const slots: (number | null)[] = [null, null, null];
    assignVoices(slots, [7, 3, 9]);
    expect(slots).toEqual([7, 3, 9]);
    assignVoices(slots, [9, 7, 3]);
    expect(slots).toEqual([7, 3, 9]);
    assignVoices(slots, [9, 4, 7]);
    expect(slots).toEqual([7, 4, 9]);
    assignVoices(slots, [4]);
    expect(slots).toEqual([null, 4, null]);
    assignVoices(slots, [1, 2, 3, 4, 5]);
    expect(new Set(slots)).toEqual(new Set([1, 2, 3]));
  });
});

describe("cloches, pas, ambiance", () => {
  it("les heures pleines sonnent leur nombre de 7 h à 21 h, midi avec une volée, rien la nuit ni en sautant des heures", () => {
    expect(bellStrikes(8.99, 9.01)).toEqual({ strikes: 9, peal: false });
    expect(bellStrikes(11.99, 12.0)).toEqual({ strikes: 12, peal: true });
    expect(bellStrikes(14.95, 15.02)).toEqual({ strikes: 3, peal: false });
    expect(bellStrikes(20.99, 21.01)).toEqual({ strikes: 9, peal: false });
    expect(bellStrikes(9.1, 9.2)).toBeNull();
    expect(bellStrikes(22.99, 23.01)).toBeNull();
    expect(bellStrikes(23.99, 0.01)).toBeNull();
    expect(bellStrikes(6.99, 7.01)).toEqual({ strikes: 7, peal: false });
    // Reprise six heures plus tard : pas de carillon.
    expect(bellStrikes(9.5, 15.5)).toBeNull();
  });

  it("pas : un appui à chaque demi-foulée", () => {
    let phase = 0, steps = 0;
    for (let i = 0; i < 400; i++) {
      const next = (phase + 0.05) % (Math.PI * 2);
      if (stepCrossed(phase, next)) steps++;
      phase = next;
    }
    // 400 × 0,05 = 20 rad, soit 3,18 foulées : 6 appuis.
    expect(steps).toBe(6);
    expect(stepCrossed(1, 1)).toBe(false);
  });

  it("ambiance : chœur de l'aube, nuit sans oiseaux, grillons l'été, rumeur de la ville le jour", () => {
    const dawn = ambience(7, 150), noon = ambience(13, 150), night = ambience(1, 150), autumn = ambience(7, 301);
    expect(dawn.birds).toBe(1);
    expect(noon.birds).toBeGreaterThan(0.2);
    expect(noon.birds).toBeLessThan(0.5);
    expect(night.birds).toBe(0);
    expect(night.crickets).toBe(1);
    expect(ambience(1, 300).crickets).toBe(0);
    expect(autumn.birds).toBe(0.5);
    expect(night.owls).toBe(1);
    expect(noon.owls).toBe(0);
    expect(noon.city).toBe(1);
    expect(night.city).toBeCloseTo(0.2);
  });
});
