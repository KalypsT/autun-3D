import { distanceCutoff, distanceGain, doppler, EngineModel, engineProfile, firingHz, stereo } from "../core/sound-model";
import { GRAVITY } from "../core/vehicle";
import { CATALOG, vehicleDef } from "../core/vehicle-catalog";
import { makeEcho, makeKit, NEAR, type Kit, type Spot } from "./kit";
import * as S from "./synth";
import { AmbienceVoice, ElectricVoice, EngineVoice, HornVoice, PedalVoice, RoadVoice, SirenVoice, TrafficVoice } from "./voices";

/**
 * Catalogue des sons (J7, D89) : chaque son du jeu dans une petite scène jouable seule. Sert à la page d'écoute (`?sounds`) et aux
 * vérifications hors ligne (`tools/sounds.sh` : rendu dans un `OfflineAudioContext`, niveaux, fichiers WAV).
 */

/** `at(t, fn)` : appelle `fn` à l'instant `t` du contexte (pour faire évoluer une voix continue). */
export type At = (t: number, fn: () => void) => void;

export interface SoundScene {
  id: string;
  section: string;
  label: string;
  /** Durée de la scène (s). */
  seconds: number;
  play(kit: Kit, dest: AudioNode, t0: number, at: At): void;
}

/** Pas des scènes animées (s). */
const TICK = 1 / 30;

/** Fait évoluer une scène de `t0` à `t0 + seconds` par pas de `TICK`. */
function animate(at: At, t0: number, seconds: number, step: (t: number, dt: number) => void): void {
  for (let t = 0; t < seconds; t += TICK) at(t0 + t, () => step(t, TICK));
}

/** Accélération à fond jusqu'à `to` (m/s), pied levé, freinage : la vitesse et les pédales d'un essai sur le plat. */
function runProfile(id: string, to: number): (t: number, dt: number, s: { v: number; throttle: number; brake: number; skid: number; phase: number; time: number }) => void {
  const spec = vehicleDef(id)!.spec;
  return (_t, dt, s) => {
    const v = s.v;
    if (s.phase === 0 && v >= to) {
      s.phase = 1;
      s.time = 0;
    }
    if (s.phase === 1 && s.time > 1.5) s.phase = 2;
    s.time += dt;
    s.throttle = s.phase === 0 ? 1 : 0;
    s.brake = s.phase === 2 ? 0.8 : 0;
    const drive = s.throttle * Math.min(spec.maxDrive, spec.power / Math.max(v, 1)) * (v > spec.driveFadeFrom ? Math.max(0, (spec.topSpeed - v) / (spec.topSpeed - spec.driveFadeFrom)) : 1);
    const resist = spec.drag * v * v + spec.rolling * spec.mass * GRAVITY + spec.engineBrake * (1 - s.throttle) + s.brake * spec.maxBrake;
    s.v = Math.max(0, v + ((drive - resist) / spec.mass) * dt);
    s.skid = 0;
  };
}

/** Essai d'un véhicule du catalogue : démarrage, accélération, lever de pied, freinage, avec klaxon ou sonnette au début. */
function vehicleScene(id: string): SoundScene {
  const def = vehicleDef(id)!, fam = def.family;
  const to = Math.min(def.spec.topSpeed * 0.95, 100 / 3.6);
  return {
    id: `run-${id}`, section: "Véhicules", label: `${def.name} : 0 à ${Math.round(to * 3.6)} km/h`, seconds: fam === "car" || fam === "moto" ? 16 : 12,
    play(kit, dest, t0, at) {
      const profile = engineProfile(id, fam);
      const model = new EngineModel(profile, def.spec.topSpeed, def.spec.reverseSpeed);
      const engine = profile.kind === "combustion" ? new EngineVoice(kit, dest, profile) : profile.kind === "electric" ? new ElectricVoice(kit, dest) : new PedalVoice(kit, dest);
      const road = new RoadVoice(kit, dest, fam === "car" ? 1 : fam === "moto" ? 0.7 : fam === "bike" ? 0.35 : 0.65);
      const combustion = profile.kind === "combustion";
      if (combustion) S.starter(kit, dest, t0, fam === "moto", { ...NEAR, gain: 0.55 });
      const horn = fam === "car" || fam === "moto" ? new HornVoice(kit, dest, fam === "moto") : null;
      const start = combustion ? 1.2 : 0.3;
      const state = { v: 0, throttle: 0, brake: 0, skid: 0, phase: 0, time: 0 };
      const physics = runProfile(id, to);
      animate(at, t0, this.seconds, (t, dt) => {
        const on = combustion ? Math.min(1, Math.max(0, (t - 0.5) * 2.5)) : 1;
        if (t >= start + 1) physics(t, dt, state);
        model.step(dt, state.v, state.throttle);
        if (engine instanceof EngineVoice) engine.update(model.rpm, model.load, on);
        else if (engine instanceof ElectricVoice) engine.update(state.v / def.spec.topSpeed, model.load, 1);
        else engine.update(state.v, def.spec.wheelRadius, state.throttle > 0, 1);
        road.update(state.v, state.skid, 1);
        horn?.press(t > start && t < start + 0.45, 0.8);
      });
      if (!horn) S.bikeBell(kit, dest, t0 + start, fam === "kickscooter" ? 1.15 : 1, { ...NEAR, gain: 0.5 });
      at(t0 + this.seconds - 0.2, () => {
        engine.stop(0.15);
        road.stop(0.15);
        horn?.stop(0.05);
      });
    },
  };
}

/** Une voix placée qui passe devant l'oreille : de −`span` à +`span` m sur l'axe est-ouest, à `side` m au nord, à `speed` m/s. */
function passScene(id: string, label: string, speed: number, siren: boolean): SoundScene {
  const span = siren ? 220 : 70, seconds = (2 * span) / speed;
  return {
    id, section: "Ville", label, seconds,
    play(kit, dest, t0, at) {
      const voice = siren ? new SirenVoice(kit, dest, 0) : new TrafficVoice(kit, dest);
      const car = siren ? null : new TrafficVoice(kit, dest);
      const model = new EngineModel(engineProfile("compacte", "car"), 205 / 3.6);
      const st = { pan: 0, behind: 0 };
      let first = true;
      animate(at, t0, seconds, (t, dt) => {
        const x = -span + speed * t, y = 6, d = Math.hypot(x, y);
        stereo(0, 0, 0, x, y, st);
        const dop = doppler(x, y, speed, 0, 0, 0);
        model.step(dt, speed, 0.4);
        const f = firingHz(model.profile, model.rpm) * dop;
        const engineGain = distanceGain(d, 5, 90) * 0.45 * (0.55 + 0.45 * model.load);
        if (voice instanceof SirenVoice) {
          voice.update(dop, distanceCutoff(d * 0.5), distanceGain(d, 15, 700) * 0.6, st.pan);
          car?.update(f, Math.min(distanceCutoff(d), 250 + f * 8), engineGain, st.pan, first);
        } else voice.update(f, Math.min(distanceCutoff(d), 250 + f * 8 * (0.5 + model.load)), engineGain, st.pan, first);
        first = false;
      });
      at(t0 + seconds - 0.1, () => {
        voice.stop(0.1);
        car?.stop(0.1);
      });
    },
  };
}

/** Un son ponctuel, rejoué `times` fois toutes les `every` secondes. */
function shot(id: string, section: string, label: string, seconds: number, fn: (kit: Kit, dest: AudioNode, t: number, i: number) => void, times = 1, every = 0): SoundScene {
  return {
    id, section, label, seconds,
    play(kit, dest, t0) {
      for (let i = 0; i < times; i++) fn(kit, dest, t0 + 0.05 + i * every, i);
    },
  };
}

const far = (d: number, pan = 0.5): Spot => ({ gain: distanceGain(d, 8, 500), pan, cutoff: distanceCutoff(d), echo: 0.5 });

export const SCENES: readonly SoundScene[] = [
  ...CATALOG.filter((d) => d.id !== "gendarmerie").map((d) => vehicleScene(d.id)),
  shot("crash-light", "Véhicules", "Choc léger (voiture)", 1.5, (k, o, t) => S.crash(k, o, t, 0.15, true, NEAR)),
  shot("crash-hard", "Véhicules", "Choc violent (voiture)", 2, (k, o, t) => S.crash(k, o, t, 1, true, NEAR)),
  shot("crash-bike", "Véhicules", "Choc à vélo", 1.5, (k, o, t) => S.crash(k, o, t, 0.4, false, { ...NEAR, gain: 0.6 })),
  shot("explosion", "Véhicules", "Explosion d'un véhicule", 3, (k, o, t) => S.explosion(k, o, t, NEAR)),
  shot("crackle", "Véhicules", "Crépitement d'un feu", 1, (k, o, t) => { for (let i = 0; i < 4; i++) S.crackle(k, o, t + i * 0.22, { ...NEAR, gain: 0.8 }); }),
  shot("pops", "Véhicules", "Pétarades (sportive)", 1.5, (k, o, t) => S.pop(k, o, t, { ...NEAR, gain: 0.5 }), 4, 0.13),
  shot("door", "Véhicules", "Portière", 1, (k, o, t) => S.door(k, o, t, { ...NEAR, gain: 0.6 })),
  shot("pistol", "Armes", "Pistolet (trois coups)", 2, (k, o, t) => S.gunshot(k, o, t, "pistol", { ...NEAR, gain: 0.85, echo: 0.45 }), 3, 0.3),
  shot("shotgun", "Armes", "Fusil à pompe", 2, (k, o, t) => {
    S.gunshot(k, o, t, "shotgun", { ...NEAR, gain: 0.85, echo: 0.45 });
    S.pump(k, o, t + 0.35, { ...NEAR, gain: 0.5 });
  }),
  shot("rifle", "Armes", "Fusil d'assaut (rafale)", 2, (k, o, t) => S.gunshot(k, o, t, "rifle", { ...NEAR, gain: 0.85, echo: 0.45 }), 10, 0.1),
  shot("pistol-far", "Armes", "Gendarme qui tire à 80 m", 2, (k, o, t) => S.gunshot(k, o, t, "pistol", far(80)), 2, 1.2),
  shot("whiz", "Armes", "Balle qui siffle", 1, (k, o, t) => S.whiz(k, o, t, { ...NEAR, gain: 0.5, pan: -0.4 })),
  shot("dry", "Armes", "Détente à vide, rechargement", 1.5, (k, o, t) => {
    S.click(k, o, t, { ...NEAR, gain: 0.5 });
    S.reload(k, o, t + 0.4, false, { ...NEAR, gain: 0.5 });
    S.reload(k, o, t + 1, true, { ...NEAR, gain: 0.5 });
  }),
  shot("punch", "Armes", "Coups de poing", 1.5, (k, o, t, i) => (i % 2 === 0 ? S.swing(k, o, t, "punch", { ...NEAR, gain: 0.6 }) : S.strike(k, o, t, "fist", { ...NEAR, gain: 0.8 })), 4, 0.15),
  shot("bat", "Armes", "Batte", 1.5, (k, o, t) => {
    S.swing(k, o, t, "swing", { ...NEAR, gain: 0.6 });
    S.strike(k, o, t + 0.25, "bat", { ...NEAR, gain: 0.8 });
  }),
  shot("knife", "Armes", "Couteau", 1, (k, o, t) => {
    S.swing(k, o, t, "stab", { ...NEAR, gain: 0.6 });
    S.strike(k, o, t + 0.12, "knife", { ...NEAR, gain: 0.8 });
  }),
  shot("steps", "Personnes", "Pas (marche puis course)", 3, (k, o, t, i) => S.footstep(k, o, t, i >= 4, { ...NEAR, gain: 0.55 }), 10, 0.28),
  shot("cry-startled", "Personnes", "Sursaut (« ah ! »)", 1, (k, o, t, i) => S.cry(k, o, t, "startled", i ? 230 : 140, { ...NEAR, gain: 0.8, echo: 0.25 }), 2, 0.5),
  shot("cry-hurt", "Personnes", "Blessé (« aïe »)", 1.5, (k, o, t, i) => S.cry(k, o, t, "hurt", i ? 240 : 130, { ...NEAR, gain: 0.8, echo: 0.25 }), 2, 0.7),
  shot("cry-scream", "Personnes", "Cri", 2.5, (k, o, t, i) => S.cry(k, o, t, "scream", i ? 250 : 135, { ...NEAR, gain: 0.8, echo: 0.25 }), 2, 1.2),
  shot("cry-oof", "Personnes", "Bousculé (« oh »)", 1, (k, o, t, i) => S.cry(k, o, t, "oof", i ? 220 : 125, { ...NEAR, gain: 0.8 }), 2, 0.4),
  shot("ped-hit", "Personnes", "Passant heurté", 1, (k, o, t) => S.strike(k, o, t, "body", NEAR)),
  shot("bells", "Ville", "Cloches de Saint-Lazare : 3 heures, à 300 m", 7, (k, o, t, i) => S.bell(k, o, t + i * 1.7, 196, { gain: 0.5, pan: -0.3, cutoff: 2500, echo: 0.3 }), 3, 0),
  shot("peal", "Ville", "Volée de midi", 9, (k, o, t) => S.peal(k, o, t, 8, { gain: 0.5, pan: -0.3, cutoff: 2500, echo: 0.3 })),
  shot("birds", "Ville", "Oiseaux", 6, (k, o, t, i) => S.birdSong(k, o, t + i * 1.4, { gain: 0.5, pan: Math.sin(i * 2.1) * 0.7, cutoff: 9000, echo: 0.1 }), 4, 0),
  shot("owl", "Ville", "Chouette hulotte", 3, (k, o, t) => S.owl(k, o, t, { gain: 0.6, pan: 0.4, cutoff: 4000, echo: 0.3 })),
  shot("pigeons", "Ville", "Envol de pigeons", 1.6, (k, o, t) => S.flutter(k, o, t, 6, { ...NEAR, gain: 0.8, pan: 0.3 })),
  shot("honk", "Ville", "Klaxons de la circulation", 2, (k, o, t, i) => S.honk(k, o, t, [0.9, 1.15, 1][i]!, [0.2, 0.35, 0.15][i]!, { gain: 0.6, pan: [0.5, -0.4, 0.5][i]!, cutoff: 6000, echo: 0.2 }), 3, 0.45),
  passScene("pass-car", "Voiture qui passe à 50 km/h", 50 / 3.6, false),
  passScene("pass-siren", "Gendarmerie qui passe à 90 km/h, sirène", 90 / 3.6, true),
  {
    id: "ambience-day", section: "Ville", label: "Fond de ville, vent (jour)", seconds: 6,
    play(kit, dest, t0, at) {
      const a = new AmbienceVoice(kit, dest);
      at(t0, () => a.update(0.7, 0.6, 0));
      at(t0 + 5.8, () => a.stop(0.2));
    },
  },
  {
    id: "ambience-night", section: "Ville", label: "Nuit d'été : grillons", seconds: 6,
    play(kit, dest, t0, at) {
      const a = new AmbienceVoice(kit, dest);
      at(t0, () => a.update(0.15, 0.6, 1));
      at(t0 + 5.8, () => a.stop(0.2));
    },
  },
  shot("stars-up", "Joueur", "Étoile de recherche gagnée", 0.6, (k, o, t) => S.jingle(k, o, t, [988, 740], 0.09, "square", 0.3)),
  shot("stars-lost", "Joueur", "Police semée", 0.8, (k, o, t) => S.jingle(k, o, t, [660, 880, 1175], 0.1, "sine", 0.3)),
  shot("pickup", "Joueur", "Arme ramassée", 0.8, (k, o, t) => {
    S.reload(k, o, t, true, { ...NEAR, gain: 0.5 });
    S.jingle(k, o, t + 0.15, [660, 990], 0.08, "sine", 0.5);
  }),
  shot("heal", "Joueur", "Croix de pharmacie ramassée", 0.8, (k, o, t) => S.jingle(k, o, t, [523, 659, 784, 1047], 0.09, "sine", 0.45)),
  shot("hurt", "Joueur", "Coup reçu", 0.6, (k, o, t) => S.hurt(k, o, t)),
  shot("death", "Joueur", "Mort", 2.5, (k, o, t) => S.death(k, o, t)),
  shot("arrest", "Joueur", "Arrestation (menottes, portière)", 1.5, (k, o, t) => {
    S.click(k, o, t, { ...NEAR, gain: 0.6 }, 1.3);
    S.click(k, o, t + 0.18, { ...NEAR, gain: 0.6 }, 1.2);
    S.door(k, o, t + 0.8, { ...NEAR, gain: 0.6 });
  }),
];

/** Mesure d'un rendu : crête, niveau moyen (RMS), part du temps au-dessus de −40 dB, échantillons invalides. */
export interface RenderStats {
  id: string;
  seconds: number;
  peak: number;
  rms: number;
  active: number;
  invalid: number;
  wav?: string;
}

/**
 * Rend une scène hors ligne (sans haut-parleur) avec la même chaîne que le jeu (écho, compresseur) : de quoi vérifier qu'aucun son
 * n'est muet, ne sature ni ne produit de valeurs invalides. `wav` : le fichier WAV en base 64.
 */
export async function renderScene(scene: SoundScene, wav = false, rate = 44100): Promise<RenderStats> {
  const seconds = scene.seconds + 0.6;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const bus = ctx.createGain();
  bus.gain.value = 0.8 * 0.64;
  bus.connect(comp);
  const kit = makeKit(ctx, makeEcho(ctx, bus));
  const quantum = 128 / rate;
  const used = new Set<number>();
  const at: At = (t, fn) => {
    if (t <= 0) {
      fn();
      return;
    }
    // Les suspensions tombent sur des blocs de 128 échantillons ; deux rappels dans le même bloc partagent la même suspension.
    let k = Math.ceil(t / quantum);
    while (used.has(k)) k++;
    used.add(k);
    void ctx.suspend(k * quantum).then(() => {
      fn();
      void ctx.resume();
    });
  };
  scene.play(kit, bus, 0, at);
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, active = 0, invalid = 0;
  const n = buf.length, l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    const a = l[i]!, b = r[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      invalid++;
      continue;
    }
    const m = Math.max(Math.abs(a), Math.abs(b));
    peak = Math.max(peak, m);
    sum += a * a + b * b;
    if (m > 0.01) active++;
  }
  const stats: RenderStats = { id: scene.id, seconds, peak, rms: Math.sqrt(sum / (2 * n)), active: active / n, invalid };
  if (wav) stats.wav = encodeWav(buf);
  return stats;
}

/** WAV 16 bits stéréo, en base 64. */
function encodeWav(buf: AudioBuffer): string {
  const n = buf.length, rate = buf.sampleRate, bytes = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  bytes.setUint32(4, 36 + n * 4, true);
  str(8, "WAVEfmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 2, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 4, true);
  bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true);
  str(36, "data");
  bytes.setUint32(40, n * 4, true);
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    bytes.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i]!)) * 32767, true);
    bytes.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i]!)) * 32767, true);
  }
  let bin = "";
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x2000) bin += String.fromCharCode(...u8.subarray(i, i + 0x2000));
  return btoa(bin);
}
