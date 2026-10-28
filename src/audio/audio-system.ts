import { makeEcho, makeKit, type Kit } from "./kit";

/**
 * Système audio du jeu (J7, D89) : un `AudioContext`, un volume général, un compresseur (les coups de feu ne saturent pas) et trois
 * bus (moteurs, effets, ambiance). Le navigateur n'autorise le son qu'après un geste de l'utilisateur : le contexte se crée au premier
 * appui ou à la première touche, puis se met en veille pendant la pause et quand la page est cachée.
 */
export interface Buses {
  engine: GainNode;
  sfx: GainNode;
  ambience: GainNode;
}

/** Niveaux des bus : les moteurs et l'ambiance sous les effets. */
const BUS_LEVELS = { engine: 0.55, sfx: 0.8, ambience: 0.6 } as const;

/** Volume du réglage (0-1) vers un gain : courbe en carré, plus naturelle à l'oreille qu'une droite. */
export function volumeGain(v: number): number {
  const x = Math.min(Math.max(v, 0), 1);
  return x * x;
}

export class AudioSystem {
  ctx: AudioContext | null = null;
  kit: Kit | null = null;
  buses: Buses | null = null;
  private master: GainNode | null = null;
  private paused = false;
  private hidden = false;
  private listening = false;
  private readonly unlock = (): void => this.wake();

  constructor(private volume: number) {
    if (volume > 0) this.listen();
    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
      this.apply();
    });
  }

  /** Prêt à jouer : contexte créé et en marche. */
  get ready(): boolean {
    return this.ctx?.state === "running";
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volumeGain(v), this.ctx.currentTime, 0.05);
    if (v > 0 && !this.ctx) this.listen();
    this.apply();
  }

  /** Pause du jeu : tout se tait (le contexte est suspendu, les sons reprennent où ils en étaient). */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.apply();
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    for (const ev of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) window.addEventListener(ev, this.unlock, { capture: true, passive: true });
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    for (const ev of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) window.removeEventListener(ev, this.unlock, { capture: true });
  }

  /** Premier geste : crée le contexte et le graphe ; ensuite, relance le contexte si le navigateur l'a suspendu. */
  private wake(): void {
    if (this.volume <= 0) return;
    if (!this.ctx) this.build();
    this.apply();
    if (this.ctx?.state === "running") this.stopListening();
  }

  private build(): void {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      this.stopListening();
      return;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = volumeGain(this.volume);
    master.connect(comp);
    comp.connect(ctx.destination);
    const bus = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(master);
      return g;
    };
    const buses = { engine: bus(BUS_LEVELS.engine), sfx: bus(BUS_LEVELS.sfx), ambience: bus(BUS_LEVELS.ambience) };
    this.kit = makeKit(ctx, makeEcho(ctx, buses.sfx));
    this.ctx = ctx;
    this.master = master;
    this.buses = buses;
    // Le navigateur peut suspendre le contexte de lui-même (appel entrant, autre onglet) : on réécoute les gestes pour le relancer.
    ctx.addEventListener("statechange", () => {
      if (ctx.state !== "running" && !this.paused && !this.hidden && this.volume > 0) this.listen();
    });
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    const want = !this.paused && !this.hidden && this.volume > 0;
    if (want && ctx.state !== "running") void ctx.resume().catch(() => undefined);
    else if (!want && ctx.state === "running") void ctx.suspend().catch(() => undefined);
  }
}
