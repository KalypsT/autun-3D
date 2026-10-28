/**
 * Boîte à outils des sons synthétisés (J7, D89) : bruits blancs et bruns, formes d'onde, sortie placée (distance, stéréo, écho).
 * Tout est fabriqué par le navigateur (Web Audio) : aucun fichier son, rien à licencier.
 * Fonctionne aussi bien sur un `AudioContext` (le jeu) que sur un `OfflineAudioContext` (vérifications sans haut-parleur).
 */

export interface Kit {
  ctx: BaseAudioContext;
  /** Deux secondes de bruit blanc et de bruit brun (plus grave), lues en boucle ou par morceaux. */
  white: AudioBuffer;
  brown: AudioBuffer;
  /** Entrée de l'écho de rue (deux réflexions sur les façades), ou null. */
  echo: AudioNode | null;
  /** Forme d'onde d'un moteur : train d'impulsions aux harmoniques irrégulières. */
  engineWave: PeriodicWave;
}

/** Où et comment entendre un son ponctuel : gain (0-1), panoramique (−1 à 1), coupure des aigus (Hz), part envoyée à l'écho. */
export interface Spot {
  gain: number;
  pan: number;
  cutoff: number;
  echo: number;
}

export const NEAR: Spot = { gain: 1, pan: 0, cutoff: 18000, echo: 0 };

export function makeKit(ctx: BaseAudioContext, echo: AudioNode | null): Kit {
  const rate = ctx.sampleRate, n = Math.floor(rate * 2);
  const white = ctx.createBuffer(1, n, rate), brown = ctx.createBuffer(1, n, rate);
  const w = white.getChannelData(0), b = brown.getChannelData(0);
  // Graine fixe : les mêmes bruits à chaque partie (et dans les vérifications).
  let seed = 0x2f6b1d3;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let last = 0;
  for (let i = 0; i < n; i++) {
    const r = rnd() * 2 - 1;
    w[i] = r;
    last = (last + 0.02 * r) / 1.02;
    b[i] = last * 3.5;
  }
  // Raccord de la boucle : fondu des 10 dernières millisecondes vers le début.
  const fade = Math.floor(rate * 0.01);
  for (let i = 0; i < fade; i++) {
    const u = i / fade;
    b[n - fade + i] = b[n - fade + i]! * (1 - u) + b[i]! * u;
  }
  const H = 48, real = new Float32Array(H), imag = new Float32Array(H);
  for (let k = 1; k < H; k++) real[k] = (1 / k ** 0.75) * (1 + 0.55 * Math.cos(k * 0.93)) * (k % 2 === 0 ? 1 : 0.8);
  const engineWave = ctx.createPeriodicWave(real, imag);
  return { ctx, white, brown, echo, engineWave };
}

/** Écho de rue : deux retards (façades proches et lointaines), assourdis, avec un peu de réinjection ; à brancher sur `dest`. */
export function makeEcho(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const input = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  input.connect(lp);
  for (const [delay, gain, feedback] of [[0.085, 0.32, 0], [0.23, 0.22, 0.28]] as const) {
    const d = ctx.createDelay(1);
    d.delayTime.value = delay;
    const g = ctx.createGain();
    g.gain.value = gain;
    lp.connect(d);
    d.connect(g);
    g.connect(dest);
    if (feedback > 0) {
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      d.connect(fb);
      fb.connect(d);
    }
  }
  return input;
}

/** Sortie d'un son ponctuel placé : passe-bas (distance), gain, panoramique, envoi d'écho. Rend l'entrée où brancher les sources. */
export function spotOut(kit: Kit, dest: AudioNode, spot: Spot): AudioNode {
  const { ctx } = kit;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = spot.cutoff;
  const g = ctx.createGain();
  g.gain.value = spot.gain;
  lp.connect(g);
  if (spot.pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.value = spot.pan;
    g.connect(p);
    p.connect(dest);
  } else g.connect(dest);
  if (spot.echo > 0 && kit.echo) {
    const e = ctx.createGain();
    e.gain.value = spot.echo * spot.gain;
    lp.connect(e);
    e.connect(kit.echo);
  }
  return lp;
}

/** Morceau de bruit (blanc ou brun) joué de `t` à `t + dur`, à un endroit pris au hasard dans la boucle. */
export function noise(kit: Kit, t: number, dur: number, brown = false): AudioBufferSourceNode {
  const s = kit.ctx.createBufferSource();
  s.buffer = brown ? kit.brown : kit.white;
  s.loop = true;
  s.start(t, Math.random() * 1.8);
  s.stop(t + dur + 0.02);
  return s;
}

/** Bruit en boucle sans fin (voix continues). */
export function noiseLoop(kit: Kit, brown = false): AudioBufferSourceNode {
  const s = kit.ctx.createBufferSource();
  s.buffer = brown ? kit.brown : kit.white;
  s.loop = true;
  s.start(kit.ctx.currentTime, Math.random() * 1.8);
  return s;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gainNode(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** Enveloppe percussive : attaque linéaire jusqu'à `peak`, puis décroissance exponentielle jusqu'au silence en `decay` secondes. */
export function hit(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Chaîne de nœuds : a → b → c… ; rend le dernier. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i]!.connect(nodes[i + 1]!);
  return nodes[nodes.length - 1]!;
}

/** Courbe d'écrêtage doux (saturation), `drive` de 1 (presque rien) à 10 (très saturé). */
export function softClip(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / k;
  }
  return c;
}
