import { firingHz, type EngineProfile } from "../core/sound-model";
import { chain, filter, gainNode, noiseLoop, softClip, type Kit } from "./kit";

/**
 * Voix continues (J7, D89) : des sons qui durent (moteur, roulement, vent, klaxon tenu, sirène, ambiance). On les crée une fois et on
 * règle leurs paramètres à chaque image, en douceur (`setTargetAtTime`) : jamais de clic quand une valeur saute.
 */

/** Constante de temps des réglages (s) : assez court pour suivre le moteur, assez long pour lisser une image ratée. */
const TC = 0.03;

abstract class Voice {
  protected readonly sources: AudioScheduledSourceNode[] = [];
  protected readonly out: GainNode;
  /** Panoramique après le gain, pour les voix placées dans la rue (null : voix centrée). */
  protected readonly panner: StereoPannerNode | null;
  stopped = false;

  constructor(protected readonly kit: Kit, dest: AudioNode, placed = false) {
    this.out = gainNode(kit.ctx, 0);
    this.panner = placed ? kit.ctx.createStereoPanner() : null;
    if (this.panner) chain(this.out, this.panner, dest);
    else this.out.connect(dest);
  }

  protected set(param: AudioParam, v: number, tc = TC): void {
    param.setTargetAtTime(v, this.kit.ctx.currentTime, tc);
  }

  protected osc(type: OscillatorType | PeriodicWave, freq: number): OscillatorNode {
    const o = this.kit.ctx.createOscillator();
    if (typeof type === "string") o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    o.start();
    this.sources.push(o);
    return o;
  }

  protected loop(brown: boolean): AudioBufferSourceNode {
    const s = noiseLoop(this.kit, brown);
    this.sources.push(s);
    return s;
  }

  /** Fondu de sortie puis arrêt (et oubli : les nœuds sont ramassés). */
  stop(fade = 0.12): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.kit.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    for (const s of this.sources) s.stop(t + fade + 0.1);
    setTimeout(() => {
      this.out.disconnect();
      this.panner?.disconnect();
    }, (fade + 0.3) * 1000);
  }
}

/**
 * Moteur thermique du joueur : train d'impulsions à la fréquence d'allumage, saturé, qui « boite » au rythme du cycle (irrégularité),
 * plus un sous-harmonique et un souffle d'admission et d'échappement synchronisé sur les allumages, le tout passé dans un filtre qui
 * s'ouvre avec la charge (pied au plancher : plus d'aigus).
 */
export class EngineVoice extends Voice {
  private readonly main: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly lp: BiquadFilterNode;
  private readonly breath: BiquadFilterNode;
  private readonly breathGain: GainNode;

  constructor(kit: Kit, dest: AudioNode, private readonly p: EngineProfile) {
    super(kit, dest);
    const { ctx } = kit;
    const f = firingHz(p, p.idle);
    this.main = this.osc(kit.engineWave, f);
    this.sub = this.osc("triangle", f / 2);
    this.lfo = this.osc("sine", p.idle / 120);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2 + p.bright * 2);
    const body = gainNode(ctx, 0.8);
    const lump = gainNode(ctx, 0.15 + p.rough * 0.55);
    this.lfo.connect(lump);
    lump.connect(body.gain);
    chain(this.main, shaper, body);
    const subGain = gainNode(ctx, 0.12 + p.rough * 0.35);
    this.sub.connect(subGain);
    this.breath = filter(ctx, "bandpass", p.diesel ? 2300 : f * 3, p.diesel ? 2.5 : 0.9);
    this.breathGain = gainNode(ctx, 0);
    chain(this.loop(false), this.breath, this.breathGain);
    const pulse = gainNode(ctx, p.diesel ? 0.5 : 0.25);
    this.main.connect(pulse);
    pulse.connect(this.breathGain.gain);
    this.lp = filter(ctx, "lowpass", 600, 0.9);
    const warm = filter(ctx, "peaking", 150, 1);
    warm.gain.value = 5;
    body.connect(this.lp);
    subGain.connect(this.lp);
    this.breathGain.connect(this.lp);
    chain(this.lp, warm, this.out);
  }

  /** Régime (tr/min), charge 0-1, volume 0-1. */
  update(rpm: number, load: number, volume: number): void {
    const p = this.p, f = firingHz(p, Math.max(rpm, p.idle * 0.5)), r = rpm / p.redline;
    this.set(this.main.frequency, f);
    this.set(this.sub.frequency, f / 2);
    this.set(this.lfo.frequency, rpm / 120);
    this.set(this.lp.frequency, Math.min(250 + f * (3 + p.bright * 6) * (0.45 + 0.55 * load) + load * 1800 * p.bright, 12000));
    if (!p.diesel) this.set(this.breath.frequency, Math.min(f * 3, 6000));
    this.set(this.breathGain.gain, (p.diesel ? 0.12 : 0.05) + load * 0.22);
    this.set(this.out.gain, volume * (0.28 + 0.5 * load) * (0.65 + 0.45 * r), 0.05);
  }
}

/** Moteur électrique (trottinette) : sifflement qui monte avec la vitesse, et son harmonique. */
export class ElectricVoice extends Voice {
  private readonly a: OscillatorNode;
  private readonly b: OscillatorNode;

  constructor(kit: Kit, dest: AudioNode) {
    super(kit, dest);
    this.a = this.osc("sine", 100);
    this.b = this.osc("triangle", 201);
    const gb = gainNode(kit.ctx, 0.25);
    this.a.connect(this.out);
    chain(this.b, gb, this.out);
  }

  /** Vitesse rapportée à la vitesse maximale (0-1), charge 0-1. */
  update(speed01: number, load: number, volume: number): void {
    const f = 140 + speed01 * 1100;
    this.set(this.a.frequency, f);
    this.set(this.b.frequency, f * 2.01);
    this.set(this.out.gain, volume * (speed01 > 0.01 ? 0.05 + 0.08 * load : 0), 0.06);
  }
}

/** Vélo : cliquetis de la roue libre quand on ne pédale pas, chaîne qui frotte doucement quand on pédale. */
export class PedalVoice extends Voice {
  private readonly tick: OscillatorNode;
  private readonly tickGain: GainNode;
  private readonly chainGain: GainNode;

  constructor(kit: Kit, dest: AudioNode) {
    super(kit, dest);
    const { ctx } = kit;
    this.tick = this.osc("square", 30);
    this.tickGain = gainNode(ctx, 0);
    chain(this.tick, filter(ctx, "highpass", 3500, 0.8), this.tickGain, this.out);
    this.chainGain = gainNode(ctx, 0);
    chain(this.loop(true), filter(ctx, "bandpass", 700, 2), this.chainGain, this.out);
    this.out.gain.value = 1;
  }

  /** Vitesse (m/s), rayon de roue (m), pédalage en cours. */
  update(speed: number, wheelRadius: number, pedalling: boolean, volume: number): void {
    const wheelHz = Math.abs(speed) / (2 * Math.PI * wheelRadius);
    // Roue libre à 24 crans : un clic par cran.
    this.set(this.tick.frequency, Math.max(wheelHz * 24, 1));
    this.set(this.tickGain.gain, volume * (!pedalling && Math.abs(speed) > 0.5 ? 0.07 : 0), 0.05);
    this.set(this.chainGain.gain, volume * (pedalling ? 0.2 * Math.min(Math.abs(speed) / 5, 1) : 0), 0.08);
  }
}

/** Route : roulement des pneus, vent de la vitesse, crissement des pneus qui glissent. */
export class RoadVoice extends Voice {
  private readonly rollLp: BiquadFilterNode;
  private readonly rollGain: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly squeal: OscillatorNode;
  private readonly skidGain: GainNode;

  constructor(kit: Kit, dest: AudioNode, private readonly tyre: number) {
    super(kit, dest);
    const { ctx } = kit;
    const brown = this.loop(true);
    this.rollLp = filter(ctx, "lowpass", 200, 0.8);
    this.rollGain = gainNode(ctx, 0);
    chain(brown, this.rollLp, this.rollGain, this.out);
    this.windBp = filter(ctx, "bandpass", 500, 0.5);
    this.windGain = gainNode(ctx, 0);
    chain(brown, this.windBp, this.windGain, this.out);
    // Crissement : une note qui tremble, plus un bruit sifflant.
    this.squeal = this.osc("sawtooth", 680);
    const jitter = this.osc("sine", 23);
    const jg = gainNode(ctx, 45);
    chain(jitter, jg);
    jg.connect(this.squeal.frequency);
    this.skidGain = gainNode(ctx, 0);
    const sq = filter(ctx, "bandpass", 1300, 4);
    chain(this.squeal, sq, gainNode(ctx, 0.5), this.skidGain);
    chain(this.loop(false), filter(ctx, "bandpass", 1900, 1.5), gainNode(ctx, 0.6), this.skidGain);
    this.skidGain.connect(this.out);
    this.out.gain.value = 1;
  }

  /** Vitesse (m/s), glissade 0-1, roues bloquées. */
  update(speed: number, skid: number, volume: number): void {
    const v = Math.abs(speed);
    this.set(this.rollLp.frequency, 180 + v * 22);
    this.set(this.rollGain.gain, volume * this.tyre * Math.min(v / 25, 1) * 0.4, 0.08);
    this.set(this.windBp.frequency, 350 + v * 14);
    this.set(this.windGain.gain, volume * Math.min((v / 45) ** 2, 1) * 0.45, 0.1);
    this.set(this.skidGain.gain, volume * skid * Math.min(v / 6, 1) * 0.35 * this.tyre, 0.04);
  }
}

/** Klaxon tenu du joueur (voiture : deux notes en tierce ; moto : une note plus aiguë). */
export class HornVoice extends Voice {
  constructor(kit: Kit, dest: AudioNode, moto: boolean) {
    super(kit, dest);
    const { ctx } = kit;
    const bp = filter(ctx, "bandpass", moto ? 1500 : 1050, 0.8);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.5);
    for (const f of moto ? [520] : [415, 523]) this.osc("sawtooth", f).connect(bp);
    chain(bp, shaper, gainNode(ctx, 0.3), this.out);
  }

  press(on: boolean, volume: number): void {
    this.set(this.out.gain, on ? volume : 0, on ? 0.006 : 0.03);
  }
}

/** Voiture de la circulation : un moteur plus simple, placé (panoramique, distance), qui change de voiture quand elle s'éloigne. */
export class TrafficVoice extends Voice {
  private readonly main: OscillatorNode;
  private readonly lp: BiquadFilterNode;

  constructor(kit: Kit, dest: AudioNode) {
    super(kit, dest, true);
    const { ctx } = kit;
    this.main = this.osc(kit.engineWave, 40);
    this.lp = filter(ctx, "lowpass", 500, 0.8);
    chain(this.loop(true), filter(ctx, "lowpass", 400), gainNode(ctx, 0.25), this.lp);
    chain(this.main, this.lp, this.out);
  }

  /** Fréquence d'allumage (Hz), coupure (Hz), gain, panoramique ; `jump` : nouvelle voiture, on coupe d'abord pour éviter un glissando. */
  update(freq: number, cutoff: number, gain: number, pan: number, jump: boolean): void {
    const t = this.kit.ctx.currentTime;
    if (jump) {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0, t);
      this.main.frequency.cancelScheduledValues(t);
      this.main.frequency.setValueAtTime(freq, t);
    } else this.set(this.main.frequency, freq, 0.05);
    this.set(this.lp.frequency, cutoff, 0.05);
    this.set(this.out.gain, gain, 0.08);
    this.set(this.panner!.pan, pan, 0.05);
  }
}

/**
 * Sirène « deux-tons » de la gendarmerie : la (435 Hz) et si (488 Hz) en alternance, une note par demi-seconde. Une oscillation
 * carrée lente fait basculer la note ; l'effet Doppler les décale ensemble.
 */
export class SirenVoice extends Voice {
  private readonly tone: OscillatorNode;
  private readonly swing: GainNode;
  private readonly lp: BiquadFilterNode;
  static readonly LOW = 435;
  static readonly HIGH = 488;

  constructor(kit: Kit, dest: AudioNode, phase: number) {
    super(kit, dest, true);
    const { ctx } = kit;
    this.tone = this.osc("square", (SirenVoice.LOW + SirenVoice.HIGH) / 2);
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 1;
    lfo.start(ctx.currentTime + phase);
    this.sources.push(lfo);
    this.swing = gainNode(ctx, (SirenVoice.HIGH - SirenVoice.LOW) / 2);
    chain(lfo, this.swing);
    this.swing.connect(this.tone.frequency);
    this.lp = filter(ctx, "lowpass", 2600, 0.7);
    chain(this.tone, this.lp, gainNode(ctx, 0.5), this.out);
  }

  update(doppler: number, cutoff: number, gain: number, pan: number): void {
    this.set(this.tone.frequency, ((SirenVoice.LOW + SirenVoice.HIGH) / 2) * doppler, 0.05);
    this.set(this.swing.gain, ((SirenVoice.HIGH - SirenVoice.LOW) / 2) * doppler, 0.05);
    this.set(this.lp.frequency, Math.min(cutoff, 2600), 0.05);
    this.set(this.out.gain, gain, 0.1);
    this.set(this.panner!.pan, pan, 0.05);
  }
}

/** Fond sonore : rumeur de la ville, vent qui va et vient, grillons des nuits d'été. */
export class AmbienceVoice extends Voice {
  private readonly city: GainNode;
  private readonly wind: GainNode;
  private readonly crickets: GainNode;

  constructor(kit: Kit, dest: AudioNode) {
    super(kit, dest);
    const { ctx } = kit;
    const brown = this.loop(true);
    this.city = gainNode(ctx, 0);
    chain(brown, filter(ctx, "lowpass", 170, 0.7), this.city, this.out);
    // Vent : bande de bruit qui respire lentement.
    this.wind = gainNode(ctx, 0);
    const gust = gainNode(ctx, 0.5);
    const lfo = this.osc("sine", 0.07);
    chain(lfo, gainNode(ctx, 0.4)).connect(gust.gain);
    chain(brown, filter(ctx, "bandpass", 420, 0.5), gust, this.wind, this.out);
    // Grillons : une note aiguë hachée (28 Hz), par salves (1,4 Hz).
    this.crickets = gainNode(ctx, 0);
    const chirp = gainNode(ctx, 0.5), burst = gainNode(ctx, 0.5);
    chain(this.osc("square", 28), gainNode(ctx, 0.5)).connect(chirp.gain);
    chain(this.osc("square", 1.4), gainNode(ctx, 0.5)).connect(burst.gain);
    chain(this.osc("sine", 4400), chirp, burst, this.crickets, this.out);
    this.out.gain.value = 1;
  }

  update(city: number, wind: number, crickets: number): void {
    this.set(this.city.gain, city * 0.5, 0.5);
    this.set(this.wind.gain, wind * 0.25, 0.5);
    this.set(this.crickets.gain, crickets * 0.03, 0.5);
  }
}
