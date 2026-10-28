import type { AudioSystem } from "../audio/audio-system";
import { NEAR, type Kit, type Spot } from "../audio/kit";
import * as S from "../audio/synth";
import { AmbienceVoice, ElectricVoice, EngineVoice, HornVoice, PedalVoice, RoadVoice, SirenVoice, TrafficVoice } from "../audio/voices";
import type { PedEvent } from "../core/pedestrians";
import {
  ambience, assignVoices, bellStrikes, CATHEDRAL, distanceCutoff, distanceGain, doppler, EngineModel, engineProfile, firingHz, stereo, type EngineProfile,
} from "../core/sound-model";
import type { VehicleSpec, VehicleState } from "../core/vehicle";
import { vehicleDef, type VehicleFamily } from "../core/vehicle-catalog";
import type { GunId, WeaponId } from "../core/weapons";

/**
 * Les sons du jeu (J7, D89) : relie ce qui se passe (véhicule conduit, tirs, passants, circulation, police, heure) aux sons de
 * `src/audio/`. Rien ne se joue avant le premier geste de l'utilisateur (règle des navigateurs) ; tout se tait pendant la pause.
 * L'oreille est la caméra : ce qui est à droite de l'écran s'entend à droite.
 */

/** Voix de la circulation (les voitures les plus proches) et sirènes (les poursuivants les plus proches). */
const TRAFFIC_VOICES = 4;
const SIREN_VOICES = 2;
/** Portée des moteurs de la circulation et des sirènes (m). */
const TRAFFIC_RANGE = 90;
const SIREN_RANGE = 700;
/** Écart entre deux coups de cloche (s), note de la cloche des heures (Hz), durée de la volée de midi (s). */
const BELL_GAP = 1.7;
const BELL_PRIME = 196;
const PEAL_SECONDS = 10;
/** Choc du véhicule du joueur audible au-delà de cette vitesse d'impact (m/s) ; intensité pleine à `CRASH_FULL`. */
const CRASH_MIN = 1.2;
const CRASH_FULL = 11;

/** Roulement des pneus selon la famille (une trottinette sur les pavés s'entend plus qu'un vélo). */
const TYRE: Record<VehicleFamily, number> = { car: 1, moto: 0.7, bike: 0.35, kickscooter: 0.65 };

interface Ride {
  family: VehicleFamily;
  spec: VehicleSpec;
  profile: EngineProfile;
  model: EngineModel;
  engine: EngineVoice | ElectricVoice | PedalVoice | null;
  road: RoadVoice | null;
  horn: HornVoice | null;
  /** Démarrage : le moteur se fait entendre une fois le démarreur passé. */
  ignition: number;
}

interface TrafficSlot {
  voice: TrafficVoice;
  model: EngineModel | null;
  lastSpeed: number;
  throttle: number;
}

interface SeenCar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  model: string;
}

/** Une voiture de la circulation telle que les sons la voient. */
export type TrafficVisit = (id: number, x: number, y: number, vx: number, vy: number, speed: number, model: string, siren: boolean) => void;

export class GameAudio {
  private readonly L = { x: 0, y: 0, yaw: 0, vx: 0, vy: 0 };
  private readonly st = { pan: 0, behind: 0 };
  private ride: Ride | null = null;
  private pendingRide: { id: string; family: VehicleFamily; spec: VehicleSpec } | null = null;
  private hornOn = false;
  private readonly carSlots: (number | null)[] = new Array<number | null>(TRAFFIC_VOICES).fill(null);
  private readonly sirenSlots: (number | null)[] = new Array<number | null>(SIREN_VOICES).fill(null);
  private carVoices: TrafficSlot[] = [];
  private sirenVoices: SirenVoice[] = [];
  private amb: AmbienceVoice | null = null;
  private prevHour = Number.NaN;
  private birdTimer = 2;
  private owlTimer = 20;
  private cryCool = 0;
  private crashCool = 0;
  private dryCool = 0;
  private popCool = 0;
  private pedSlots: number[] = [];
  private readonly cand: { id: number; score: number }[] = [];
  private readonly sirenCand: { id: number; score: number }[] = [];
  private readonly ids: number[] = [];
  private readonly before: (number | null)[] = [];
  /** Voitures vues à cette image (objets réutilisés d'une image à l'autre), par identifiant. */
  private readonly seen = new Map<number, SeenCar>();
  private readonly pool: SeenCar[] = [];
  /** Diagnostic : voix continues en jeu. */
  voices = 0;

  constructor(private readonly sys: AudioSystem) {}

  private get kit(): Kit | null {
    return this.sys.ready ? this.sys.kit : null;
  }

  /** Oreille : position de la caméra, direction du regard (0 = nord), vitesse (m/s). */
  listen(x: number, y: number, yaw: number, vx: number, vy: number): void {
    Object.assign(this.L, { x, y, yaw, vx, vy });
  }

  /** Placement d'un son ponctuel à (x, y) : null s'il est hors de portée. */
  private spot(x: number, y: number, ref: number, max: number, echo = 0.15, gain = 1): Spot | null {
    const d = Math.hypot(x - this.L.x, y - this.L.y);
    const g = distanceGain(d, ref, max) * gain;
    if (g < 0.003) return null;
    stereo(this.L.x, this.L.y, this.L.yaw, x, y, this.st);
    return { gain: g * (1 - 0.25 * this.st.behind), pan: this.st.pan, cutoff: distanceCutoff(d) * (1 - 0.45 * this.st.behind), echo };
  }

  // --- Véhicule du joueur ----------------------------------------------------------------------------------------------------

  /** Monte sur un véhicule (null : en descend). */
  setRide(v: { id: string; family: VehicleFamily; spec: VehicleSpec } | null): void {
    const old = this.ride, kit = this.kit;
    if (old) {
      old.engine?.stop(0.35);
      old.road?.stop(0.2);
      old.horn?.stop(0.05);
      if (kit && old.family === "car") S.door(kit, this.sys.buses!.sfx, kit.ctx.currentTime + 0.25, { ...NEAR, gain: 0.6 });
    }
    this.ride = null;
    this.hornOn = false;
    this.pendingRide = v;
    if (v && kit) this.build(v, true);
  }

  private build(v: { id: string; family: VehicleFamily; spec: VehicleSpec }, fresh: boolean): void {
    const kit = this.kit!, buses = this.sys.buses!;
    this.pendingRide = null;
    const profile = engineProfile(v.id, v.family);
    const model = new EngineModel(profile, v.spec.topSpeed, v.spec.reverseSpeed);
    const engine = profile.kind === "combustion" ? new EngineVoice(kit, buses.engine, profile) : profile.kind === "electric" ? new ElectricVoice(kit, buses.engine) : new PedalVoice(kit, buses.engine);
    const motor = v.family === "car" || v.family === "moto";
    const t = kit.ctx.currentTime;
    if (fresh && v.family === "car") S.door(kit, buses.sfx, t, { ...NEAR, gain: 0.6 });
    if (fresh && profile.kind === "combustion") S.starter(kit, buses.sfx, t + (v.family === "car" ? 0.3 : 0.05), v.family === "moto", { ...NEAR, gain: 0.55 });
    this.ride = {
      family: v.family, spec: v.spec, profile, model, engine,
      road: new RoadVoice(kit, buses.engine, TYRE[v.family]),
      horn: motor ? new HornVoice(kit, buses.sfx, v.family === "moto") : null,
      ignition: fresh && profile.kind === "combustion" ? (v.family === "car" ? -0.75 : -0.35) : 1,
    };
  }

  /** À chaque image au volant : état du véhicule et pédales. */
  drive(dt: number, s: VehicleState, throttle: number, brake: number): void {
    if (!this.ride && this.pendingRide && this.kit) this.build(this.pendingRide, false);
    const r = this.ride;
    if (!r) return;
    // En marche arrière, c'est la pédale de frein qui fait tourner le moteur.
    const pedal = s.speed < -0.3 ? brake : throttle;
    r.model.step(dt, s.speed, pedal);
    r.ignition = Math.min(1, r.ignition + dt * 2.5);
    const on = Math.max(0, r.ignition);
    const m = r.model, p = r.profile;
    if (r.engine instanceof EngineVoice) r.engine.update(m.rpm, m.load, on);
    else if (r.engine instanceof ElectricVoice) r.engine.update(Math.abs(s.speed) / r.spec.topSpeed, m.load, 1);
    else r.engine?.update(s.speed, r.spec.wheelRadius, pedal > 0.05, 1);
    r.road?.update(s.speed, s.skid, 1);
    this.popCool -= dt;
    const kit = this.kit;
    if (kit && m.overrun && p.pops && this.popCool <= 0 && Math.random() < dt * 7) {
      this.popCool = 0.08;
      S.pop(kit, this.sys.buses!.sfx, kit.ctx.currentTime, { ...NEAR, gain: 0.5 });
    }
  }

  /** Klaxon (voiture, moto) ou sonnette (vélo, trottinette), tenu ou non. */
  horn(held: boolean): void {
    const r = this.ride, kit = this.kit;
    const pressed = held && !this.hornOn;
    this.hornOn = held;
    if (!r || !kit) return;
    if (r.horn) r.horn.press(held, 0.8);
    else if (pressed) S.bikeBell(kit, this.sys.buses!.sfx, kit.ctx.currentTime, r.family === "kickscooter" ? 1.15 : 1, { ...NEAR, gain: 0.5 });
  }

  /** Choc du véhicule du joueur (vitesse d'impact, m/s). */
  impact(speed: number): void {
    const kit = this.kit;
    if (!kit || !this.ride || speed < CRASH_MIN || this.crashCool > 0) return;
    this.crashCool = 0.15;
    const k = (speed - CRASH_MIN) / (CRASH_FULL - CRASH_MIN);
    const car = this.ride.family === "car";
    S.crash(kit, this.sys.buses!.sfx, kit.ctx.currentTime, k, car || this.ride.family === "moto", { ...NEAR, gain: car ? 1 : 0.6 });
  }

  // --- À pied, armes -----------------------------------------------------------------------------------------------------------

  footstep(run: boolean): void {
    const kit = this.kit;
    if (kit) S.footstep(kit, this.sys.buses!.sfx, kit.ctx.currentTime, run, { ...NEAR, gain: 0.55 });
  }

  /** Coup de feu : `own` pour l'arme du joueur, sinon un tireur à (x, y). */
  shot(gun: GunId, x: number, y: number, own: boolean): void {
    const kit = this.kit;
    if (!kit) return;
    const spot = own ? { ...NEAR, gain: 0.85, echo: 0.45 } : this.spot(x, y, 8, 500, 0.5);
    if (!spot) return;
    const t = kit.ctx.currentTime;
    S.gunshot(kit, this.sys.buses!.sfx, t, gun, spot);
    if (own && gun === "shotgun") S.pump(kit, this.sys.buses!.sfx, t + 0.35, { ...NEAR, gain: 0.5 });
  }

  /** Balle d'un gendarme qui manque le joueur : sifflement si elle passe à moins de 4 m de lui (px, py). */
  nearMiss(x0: number, y0: number, x1: number, y1: number, px: number, py: number): void {
    const kit = this.kit;
    if (!kit) return;
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.min(Math.max(((px - x0) * dx + (py - y0) * dy) / l2, 0), 1) : 0;
    if (Math.hypot(x0 + dx * u - px, y0 + dy * u - py) > 4) return;
    S.whiz(kit, this.sys.buses!.sfx, kit.ctx.currentTime + 0.03, { ...NEAR, gain: 0.5, pan: (Math.random() - 0.5) * 1.2 });
  }

  /** Détente à vide (au plus quatre fois par seconde). */
  dry(): void {
    const kit = this.kit;
    if (!kit || this.dryCool > 0) return;
    this.dryCool = 0.25;
    S.click(kit, this.sys.buses!.sfx, kit.ctx.currentTime, { ...NEAR, gain: 0.5 });
  }

  reload(done: boolean): void {
    const kit = this.kit;
    if (kit) S.reload(kit, this.sys.buses!.sfx, kit.ctx.currentTime, done, { ...NEAR, gain: 0.5 });
  }

  /** Coup dans le vide (début d'un coup), puis coup qui porte. */
  swing(style: S.SwingStyle): void {
    const kit = this.kit;
    if (kit) S.swing(kit, this.sys.buses!.sfx, kit.ctx.currentTime, style, { ...NEAR, gain: 0.6 });
  }

  meleeHit(weapon: WeaponId): void {
    const kit = this.kit;
    if (kit) S.strike(kit, this.sys.buses!.sfx, kit.ctx.currentTime, weapon === "bat" ? "bat" : weapon === "knife" ? "knife" : "fist", { ...NEAR, gain: 0.8 });
  }

  pickup(): void {
    const kit = this.kit;
    if (!kit) return;
    const t = kit.ctx.currentTime;
    S.reload(kit, this.sys.buses!.sfx, t, true, { ...NEAR, gain: 0.5 });
    S.jingle(kit, this.sys.buses!.sfx, t + 0.15, [660, 990], 0.08, "sine", 0.5);
  }

  // --- Joueur : santé, recherche ---------------------------------------------------------------------------------------------

  hurt(): void {
    const kit = this.kit;
    if (kit) S.hurt(kit, this.sys.buses!.sfx, kit.ctx.currentTime);
  }

  death(): void {
    const kit = this.kit;
    if (kit) S.death(kit, this.sys.buses!.sfx, kit.ctx.currentTime);
  }

  arrest(): void {
    const kit = this.kit;
    if (!kit) return;
    const t = kit.ctx.currentTime, sfx = this.sys.buses!.sfx;
    S.click(kit, sfx, t, { ...NEAR, gain: 0.6 }, 1.3);
    S.click(kit, sfx, t + 0.18, { ...NEAR, gain: 0.6 }, 1.2);
    S.door(kit, sfx, t + 0.8, { ...NEAR, gain: 0.6 });
  }

  /** Étoiles de recherche : une alerte quand elles montent, un air soulagé quand la police perd la piste. */
  stars(now: number, before: number): void {
    const kit = this.kit;
    if (!kit || now === before) return;
    const t = kit.ctx.currentTime, sfx = this.sys.buses!.sfx;
    if (now > before) S.jingle(kit, sfx, t, [988, 740], 0.09, "square", 0.3);
    else if (now === 0) S.jingle(kit, sfx, t, [660, 880, 1175], 0.1, "sine", 0.3);
  }

  // --- Monde -------------------------------------------------------------------------------------------------------------------

  /** Événements des passants (chocs, sursauts, blessures) : coups sourds et cris. */
  pedEvents(events: readonly PedEvent[]): void {
    const kit = this.kit;
    if (!kit || events.length === 0) return;
    const sfx = this.sys.buses!.sfx, t = kit.ctx.currentTime;
    this.pedSlots.length = 0;
    for (const e of events) {
      if (e.kind === "hit") {
        const sp = this.spot(e.x, e.y, 6, 120);
        if (sp) S.strike(kit, sfx, t, "body", { ...sp, gain: sp.gain * Math.min(1, 0.4 + e.speed / 12) });
      }
      const kind: S.CryKind | null =
        e.kind === "killed" ? "scream" : e.kind === "hurt" || e.kind === "hit" ? "hurt" : e.kind === "bump" || e.kind === "stumble" ? "oof" :
        (e.kind === "startled" || e.kind === "near_miss") && Math.random() < 0.3 ? "startled" : null;
      if (!kind || this.cryCool > 0 || this.pedSlots.includes(e.slot)) continue;
      const sp = this.spot(e.x, e.y, 5, 90, 0.25, 0.8);
      if (!sp) continue;
      this.pedSlots.push(e.slot);
      this.cryCool = kind === "startled" ? 0.35 : 0.18;
      S.cry(kit, sfx, t + Math.random() * 0.08, kind, voiceOf(e.slot), sp);
    }
  }

  /** Envol d'une volée de pigeons. */
  scatter(x: number, y: number): void {
    const kit = this.kit;
    const sp = kit && this.spot(x, y, 6, 70);
    if (kit && sp) S.flutter(kit, this.sys.buses!.sfx, kit.ctx.currentTime, 6, sp);
  }

  /** Klaxon d'un conducteur de la circulation. */
  honk(x: number, y: number): void {
    const kit = this.kit;
    const sp = kit && this.spot(x, y, 8, 200, 0.2);
    if (!kit || !sp) return;
    const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) % 1;
    S.honk(kit, this.sys.buses!.sfx, kit.ctx.currentTime, 0.85 + h * 0.35, 0.18 + h * 0.25, sp);
  }

  /**
   * Circulation : les quatre voitures les plus proches ont un moteur, les deux gendarmeries en poursuite les plus proches une sirène.
   * `each` parcourt les voitures (`Traffic.forEachSound`).
   */
  traffic(dt: number, each: ((visit: TrafficVisit) => void) | null): void {
    const kit = this.kit;
    if (!kit) return;
    const buses = this.sys.buses!;
    if (this.carVoices.length === 0) {
      for (let i = 0; i < TRAFFIC_VOICES; i++) this.carVoices.push({ voice: new TrafficVoice(kit, buses.engine), model: null, lastSpeed: 0, throttle: 0 });
      for (let i = 0; i < SIREN_VOICES; i++) this.sirenVoices.push(new SirenVoice(kit, buses.sfx, i * 0.37));
    }
    const L = this.L, cand = this.cand, sc = this.sirenCand, ids = this.ids, before = this.before;
    cand.length = 0;
    sc.length = 0;
    this.seen.clear();
    let used = 0;
    each?.((id, x, y, vx, vy, speed, model, siren) => {
      const d = Math.hypot(x - L.x, y - L.y);
      if (d >= SIREN_RANGE) return;
      if (d < TRAFFIC_RANGE) cand.push({ id, score: d });
      if (siren) sc.push({ id, score: d });
      const c = this.pool[used] ?? (this.pool[used] = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, model: "" });
      used++;
      Object.assign(c, { x, y, vx, vy, speed, model });
      this.seen.set(id, c);
    });
    cand.sort((a, b) => a.score - b.score);
    sc.sort((a, b) => a.score - b.score);
    before.length = 0;
    for (const s of this.carSlots) before.push(s);
    ids.length = 0;
    for (const c of cand) ids.push(c.id);
    assignVoices(this.carSlots, ids);
    ids.length = 0;
    for (const c of sc) ids.push(c.id);
    assignVoices(this.sirenSlots, ids);
    for (let i = 0; i < TRAFFIC_VOICES; i++) {
      const slot = this.carVoices[i]!, id = this.carSlots[i]!, car = id === null ? undefined : this.seen.get(id);
      if (!car) {
        slot.voice.update(40, 400, 0, 0, false);
        slot.model = null;
        continue;
      }
      const jump = before[i] !== id || !slot.model;
      if (jump) {
        const def = vehicleDef(car.model);
        slot.model = new EngineModel(engineProfile(car.model, def?.family ?? "car"), def?.spec.topSpeed ?? 50);
        slot.lastSpeed = car.speed;
        slot.throttle = 0.3;
      }
      // Les conducteurs n'ont pas de pédale visible : l'accélération en tient lieu.
      const acc = dt > 0 ? (car.speed - slot.lastSpeed) / dt : 0;
      slot.lastSpeed = car.speed;
      slot.throttle += (Math.min(Math.max(0.15 + acc / 2.5, 0), 1) - slot.throttle) * Math.min(1, dt * 4);
      const m = slot.model!;
      m.step(dt, car.speed, slot.throttle);
      const dx = car.x - L.x, dy = car.y - L.y, d = Math.hypot(dx, dy);
      const dop = doppler(dx, dy, car.vx, car.vy, L.vx, L.vy);
      stereo(L.x, L.y, L.yaw, car.x, car.y, this.st);
      const f = firingHz(m.profile, m.rpm) * dop;
      const gain = distanceGain(d, 5, TRAFFIC_RANGE) * 0.45 * (0.55 + 0.45 * m.load) * (1 - 0.25 * this.st.behind);
      slot.voice.update(f, Math.min(distanceCutoff(d), 250 + f * 8 * (0.5 + m.load)), gain, this.st.pan, jump);
    }
    for (let i = 0; i < SIREN_VOICES; i++) {
      const id = this.sirenSlots[i]!, car = id === null ? undefined : this.seen.get(id), v = this.sirenVoices[i]!;
      if (!car) {
        v.update(1, 2600, 0, 0);
        continue;
      }
      const dx = car.x - L.x, dy = car.y - L.y, d = Math.hypot(dx, dy);
      stereo(L.x, L.y, L.yaw, car.x, car.y, this.st);
      v.update(doppler(dx, dy, car.vx, car.vy, L.vx, L.vy), distanceCutoff(d * 0.5), distanceGain(d, 15, SIREN_RANGE) * 0.6 * (1 - 0.2 * this.st.behind), this.st.pan);
    }
  }

  /** À chaque image : minuteries, ambiance (heure 0-24, jour de l'année), cloches. */
  update(dt: number, hour: number, day: number): void {
    this.cryCool -= dt;
    this.crashCool -= dt;
    this.dryCool -= dt;
    const kit = this.kit;
    if (!kit) return;
    const buses = this.sys.buses!;
    if (!this.amb) this.amb = new AmbienceVoice(kit, buses.ambience);
    const a = ambience(hour, day);
    this.amb.update(a.city * 0.7, 0.6, a.crickets);
    const t = kit.ctx.currentTime;
    // Oiseaux et chouettes : au hasard autour de l'oreille, d'autant plus souvent que l'heure s'y prête.
    this.birdTimer -= dt * a.birds;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1 + Math.random() * 3.5;
      const sp = this.around(10, 40, 0.5);
      if (sp) S.birdSong(kit, buses.ambience, t, sp);
    }
    this.owlTimer -= dt * a.owls;
    if (this.owlTimer <= 0) {
      this.owlTimer = 25 + Math.random() * 40;
      const sp = this.around(40, 120, 0.8);
      if (sp) S.owl(kit, buses.ambience, t, sp);
    }
    // Cloches de la cathédrale : l'heure pleine, entendue de toute la ville (on garde les graves au loin).
    if (!Number.isNaN(this.prevHour)) {
      const b = bellStrikes(this.prevHour, hour);
      const sp = b && this.spot(CATHEDRAL.x, CATHEDRAL.y, 150, 4000, 0.3, 0.8);
      if (b && sp) {
        const bell = { ...sp, cutoff: Math.max(sp.cutoff, 1600) };
        for (let i = 0; i < b.strikes; i++) S.bell(kit, buses.sfx, t + 0.2 + i * BELL_GAP, BELL_PRIME, bell);
        if (b.peal) S.peal(kit, buses.sfx, t + 0.2 + b.strikes * BELL_GAP + 1.5, PEAL_SECONDS, bell);
      }
    }
    this.prevHour = hour;
    this.voices = (this.ride ? 3 : 0) + this.carVoices.length + this.sirenVoices.length + (this.amb ? 1 : 0);
  }

  /** Un point au hasard à `min`-`max` m de l'oreille. */
  private around(min: number, max: number, gain: number): Spot | null {
    const a = Math.random() * Math.PI * 2, r = min + Math.random() * (max - min);
    return this.spot(this.L.x + Math.sin(a) * r, this.L.y + Math.cos(a) * r, 8, max * 2, 0.1, gain);
  }

  /** Ligne de diagnostic (`?debug`). */
  get info(): string {
    if (!this.sys.ctx) return "son : en attente d'un geste";
    const cars = this.carSlots.filter((s) => s !== null).length, sirens = this.sirenSlots.filter((s) => s !== null).length;
    return `son ${this.sys.ctx.state} ${this.voices} voix (${cars} moteurs, ${sirens} sirènes)`;
  }
}

/** Hauteur de voix d'un passant (Hz), stable d'un cri à l'autre : grave ou aiguë selon son emplacement. */
function voiceOf(slot: number): number {
  const h = Math.abs(Math.sin(slot * 91.17)) % 1;
  return h < 0.5 ? 115 + h * 90 : 200 + (h - 0.5) * 140;
}
