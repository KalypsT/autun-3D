import { chain, filter, gainNode, hit, noise, spotOut, type Kit, type Spot } from "./kit";

/**
 * Sons ponctuels (J7, D89) : chacun fabrique ses nœuds, les branche sur `dest` à travers `spotOut` (distance, stéréo, écho) et
 * les laisse s'éteindre ; le navigateur les ramasse une fois les sources arrêtées. `t` est l'instant de départ dans le contexte.
 */

type Rand = () => number;
const rnd: Rand = Math.random;

/** Sinus dont la fréquence glisse de f0 à f1 pendant `glide` secondes, enveloppe percussive. */
function tone(kit: Kit, to: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, attack: number, decay: number): void {
  const { ctx } = kit;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  const g = ctx.createGain();
  hit(g.gain, t, peak, attack, decay);
  o.connect(g);
  g.connect(to);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

/** Souffle de bruit filtré, enveloppe percussive. */
function burst(kit: Kit, to: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, brown = false): BiquadFilterNode {
  const { ctx } = kit;
  const f = filter(ctx, type, freq, q);
  const g = ctx.createGain();
  hit(g.gain, t, peak, attack, decay);
  chain(noise(kit, t, attack + decay + 0.05, brown), f, g, to);
  return f;
}

// --- Armes ------------------------------------------------------------------------------------------------------------------

export type ShotKind = "pistol" | "shotgun" | "rifle";

const SHOTS: Record<ShotKind, { crackHz: number; crack: number; body: number; bodyHz: number; thump: [number, number, number]; gain: number }> = {
  pistol: { crackHz: 1500, crack: 0.06, body: 0.22, bodyHz: 1300, thump: [150, 45, 0.12], gain: 0.9 },
  shotgun: { crackHz: 900, crack: 0.08, body: 0.42, bodyHz: 900, thump: [115, 35, 0.22], gain: 1 },
  rifle: { crackHz: 2100, crack: 0.045, body: 0.15, bodyHz: 1700, thump: [170, 60, 0.08], gain: 0.85 },
};

/** Coup de feu : claquement (aigus), corps (souffle qui s'assourdit) et coup sourd (basse qui tombe), avec l'écho de la rue. */
export function gunshot(kit: Kit, dest: AudioNode, t: number, kind: ShotKind, spot: Spot): void {
  const s = SHOTS[kind], out = spotOut(kit, dest, { ...spot, gain: spot.gain * s.gain, echo: Math.max(spot.echo, 0.45) });
  burst(kit, out, t, "highpass", s.crackHz, 0.7, 1, 0.0007, s.crack);
  const body = burst(kit, out, t, "lowpass", s.bodyHz, 0.9, 0.8, 0.002, s.body);
  body.frequency.setValueAtTime(s.bodyHz, t);
  body.frequency.exponentialRampToValueAtTime(260, t + s.body);
  tone(kit, out, t, "sine", s.thump[0], s.thump[1], s.thump[2], 0.9, 0.002, s.thump[2]);
}

/** Petit clic métallique (détente à vide, chargeur, menottes). */
export function click(kit: Kit, dest: AudioNode, t: number, spot: Spot, bright = 1): void {
  const out = spotOut(kit, dest, spot);
  burst(kit, out, t, "bandpass", 3200 * bright, 2.5, 0.6, 0.0005, 0.025);
  tone(kit, out, t, "triangle", 2400 * bright, 2400 * bright, 0, 0.12, 0.001, 0.04);
}

/** Rechargement : le chargeur qui sort (début) ou qui rentre et la culasse (fin). */
export function reload(kit: Kit, dest: AudioNode, t: number, done: boolean, spot: Spot): void {
  click(kit, dest, t, spot, done ? 0.8 : 1.1);
  click(kit, dest, t + (done ? 0.12 : 0.08), spot, done ? 1.2 : 0.7);
}

/** Pompe du fusil à pompe : clac-clac. */
export function pump(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  burst(kit, out, t, "bandpass", 1400, 2, 0.5, 0.002, 0.06);
  burst(kit, out, t + 0.16, "bandpass", 1900, 2, 0.6, 0.002, 0.05);
}

/** Sifflement d'une balle qui passe tout près. */
export function whiz(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const f = burst(kit, out, t, "bandpass", 4200, 4, 0.9, 0.02, 0.12);
  f.frequency.setValueAtTime(5200, t);
  f.frequency.exponentialRampToValueAtTime(1800, t + 0.14);
}

export type SwingStyle = "punch" | "stab" | "swing" | "aim";

/** Coup dans le vide : souffle qui monte (plus grave pour la batte, plus bref pour le couteau). */
export function swing(kit: Kit, dest: AudioNode, t: number, style: SwingStyle, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const [f0, f1, d, g] = style === "swing" ? [300, 900, 0.26, 0.45] : style === "stab" ? [1200, 3000, 0.1, 0.3] : [600, 1600, 0.13, 0.22];
  const f = burst(kit, out, t, "bandpass", f0, 1.6, g, d * 0.6, d * 0.5);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + d);
}

export type HitKind = "fist" | "bat" | "knife" | "body";

/** Coup qui porte : coup sourd, plus un « toc » de bois pour la batte. `body` : un passant heurté par une voiture. */
export function strike(kit: Kit, dest: AudioNode, t: number, kind: HitKind, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const deep = kind === "body" ? 0.7 : 1;
  tone(kit, out, t, "sine", 130 * deep, 45, 0.09, 0.9, 0.002, kind === "body" ? 0.18 : 0.1);
  burst(kit, out, t, "lowpass", kind === "body" ? 500 : 900, 0.8, 0.6, 0.001, 0.05, true);
  if (kind === "bat") {
    burst(kit, out, t, "bandpass", 750, 6, 0.7, 0.001, 0.09);
    tone(kit, out, t, "triangle", 230, 220, 0.1, 0.25, 0.001, 0.14);
  }
  if (kind === "knife") burst(kit, out, t, "highpass", 2600, 0.7, 0.25, 0.002, 0.05);
}

// --- Véhicules --------------------------------------------------------------------------------------------------------------

/**
 * Choc d'un véhicule : fracas (bruit qui s'assourdit), tôle qui sonne (partiels inharmoniques) pour une voiture, et verre au-delà
 * d'un choc violent. `intensity` 0 (frôlement) à 1 (choc à 40 km/h et plus).
 */
export function crash(kit: Kit, dest: AudioNode, t: number, intensity: number, metal: boolean, spot: Spot): void {
  const k = Math.min(Math.max(intensity, 0), 1);
  const out = spotOut(kit, dest, { ...spot, echo: Math.max(spot.echo, 0.3) });
  const f = burst(kit, out, t, "lowpass", 700 + 2600 * k, 0.8, 0.35 + 0.65 * k, 0.002, 0.15 + 0.45 * k, true);
  f.frequency.setValueAtTime(700 + 2600 * k, t);
  f.frequency.exponentialRampToValueAtTime(220, t + 0.15 + 0.45 * k);
  burst(kit, out, t, "bandpass", 1800, 1.2, 0.25 + 0.35 * k, 0.001, 0.08 + 0.12 * k);
  tone(kit, out, t, "sine", 95, 40, 0.15, 0.6 + 0.4 * k, 0.002, 0.2);
  if (metal) {
    const base = 260 + rnd() * 120;
    for (const [r, a, d] of [[1, 0.25, 0.5], [1.71, 0.18, 0.4], [2.93, 0.12, 0.3], [4.4, 0.08, 0.22]] as const) tone(kit, out, t, "sine", base * r, base * r * 0.98, 0.3, a * (0.3 + 0.7 * k), 0.002, d * (0.5 + k));
  }
  if (k > 0.55) for (let i = 0; i < 9; i++) tone(kit, out, t + 0.02 + rnd() * 0.35, "sine", 3000 + rnd() * 4500, 3000 + rnd() * 4500, 0.05, 0.08 * k, 0.001, 0.06 + rnd() * 0.1);
}

/** Portière qui claque : coup sourd et pêne. */
export function door(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  tone(kit, out, t, "sine", 95, 50, 0.1, 0.8, 0.002, 0.14);
  burst(kit, out, t, "lowpass", 600, 0.8, 0.5, 0.002, 0.08, true);
  burst(kit, out, t + 0.005, "bandpass", 3000, 3, 0.25, 0.001, 0.03);
}

/** Démarreur : le moteur qui tourne par à-coups (temps de compression) avant de partir. */
export function starter(kit: Kit, dest: AudioNode, t: number, moto: boolean, spot: Spot): void {
  const { ctx } = kit;
  const out = spotOut(kit, dest, spot);
  const dur = moto ? 0.35 : 0.55;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(moto ? 210 : 150, t);
  const am = ctx.createOscillator();
  am.frequency.value = moto ? 14 : 9;
  const amg = gainNode(ctx, 0.35);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.03);
  g.gain.setValueAtTime(0.35, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, t + dur);
  am.connect(amg);
  amg.connect(g.gain);
  chain(o, filter(ctx, "lowpass", 1100), g, out);
  o.start(t);
  am.start(t);
  o.stop(t + dur + 0.05);
  am.stop(t + dur + 0.05);
}

/** Pétarade (échappement d'une sportive au lever de pied). */
export function pop(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, { ...spot, echo: Math.max(spot.echo, 0.25) });
  burst(kit, out, t, "lowpass", 1400, 1, 0.55, 0.001, 0.05, true);
  tone(kit, out, t, "sine", 110, 60, 0.05, 0.4, 0.001, 0.06);
}

/** Coup de klaxon bref d'une voiture de la circulation (hauteur propre à la voiture). */
export function honk(kit: Kit, dest: AudioNode, t: number, pitch: number, dur: number, spot: Spot): void {
  const { ctx } = kit;
  const out = spotOut(kit, dest, { ...spot, echo: Math.max(spot.echo, 0.2) });
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.012);
  g.gain.setValueAtTime(0.32, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  const bp = filter(ctx, "bandpass", 1100, 0.9);
  bp.connect(g);
  g.connect(out);
  for (const r of [1, 1.26]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 400 * pitch * r;
    o.connect(bp);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

/** Sonnette de vélo : deux coups sur un timbre (partiels inharmoniques qui sonnent longtemps). */
export function bikeBell(kit: Kit, dest: AudioNode, t: number, pitch: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  for (const dt of [0, 0.075]) {
    for (const [r, a, d] of [[1, 0.3, 0.7], [1.51, 0.16, 0.45], [2.33, 0.12, 0.3], [3.12, 0.06, 0.2]] as const) {
      const f = 2350 * pitch * r;
      tone(kit, out, t + dt, "sine", f, f, 0, a, 0.002, d);
    }
  }
}

// --- Personnes ---------------------------------------------------------------------------------------------------------------

/** Pas : petit frottement et coup sourd ; plus fort en courant. */
export function footstep(kit: Kit, dest: AudioNode, t: number, run: boolean, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const v = (run ? 1 : 0.6) * (0.85 + rnd() * 0.3);
  burst(kit, out, t, "bandpass", 1500 + rnd() * 900, 0.9, 0.28 * v, 0.004, 0.05);
  tone(kit, out, t, "sine", 95, 60, 0.04, 0.35 * v, 0.003, 0.06);
}

export type CryKind = "startled" | "hurt" | "scream" | "oof";

/** Voyelles (trois formants, Hz) : a, i, o. */
const VOWEL = { a: [800, 1200, 2600], i: [300, 2200, 2900], o: [480, 850, 2500] } as const;

/**
 * Cri d'un passant, par synthèse de formants (comme une voix de robot très simple) : une source en dents de scie à la hauteur de la
 * voix, filtrée par trois résonances qui font la voyelle. « startled » : un « ah ! » bref ; « hurt » : « aïe » ; « scream » : un long
 * cri ; « oof » : « oh » sourd (bousculé, trébuche). `voice` : hauteur de la voix (Hz, ≈ 120 grave à 260 aigu).
 */
export function cry(kit: Kit, dest: AudioNode, t: number, kind: CryKind, voice: number, spot: Spot): void {
  const { ctx } = kit;
  const out = spotOut(kit, dest, { ...spot, echo: Math.max(spot.echo, 0.25) });
  const [dur, p0, p1, from, to, peak] =
    kind === "scream" ? [0.95, 2.1, 1.5, VOWEL.a, VOWEL.a, 0.55] :
    kind === "hurt" ? [0.45, 1.7, 1.1, VOWEL.a, VOWEL.i, 0.5] :
    kind === "startled" ? [0.3, 1.5, 1.9, VOWEL.a, VOWEL.a, 0.42] :
    [0.2, 1.1, 0.85, VOWEL.o, VOWEL.o, 0.35];
  const src = ctx.createOscillator();
  src.type = "sawtooth";
  src.frequency.setValueAtTime(voice * p0, t);
  src.frequency.linearRampToValueAtTime(voice * p1, t + dur);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.5 + rnd();
  const vibg = gainNode(ctx, voice * 0.03);
  vib.connect(vibg);
  vibg.connect(src.frequency);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.03);
  env.gain.setValueAtTime(peak, t + dur * 0.7);
  env.gain.linearRampToValueAtTime(0, t + dur);
  env.connect(out);
  for (let i = 0; i < 3; i++) {
    const f = filter(ctx, "bandpass", from[i]!, 7 + i * 3);
    f.frequency.setValueAtTime(from[i]!, t + dur * 0.35);
    f.frequency.linearRampToValueAtTime(to[i]!, t + dur * 0.8);
    const g = gainNode(ctx, [1, 0.55, 0.25][i]!);
    src.connect(f);
    f.connect(g);
    g.connect(env);
  }
  // Un peu de souffle.
  chain(noise(kit, t, dur), filter(ctx, "bandpass", from[1]!, 2), gainNode(ctx, 0.08), env);
  src.start(t);
  vib.start(t);
  src.stop(t + dur + 0.05);
  vib.stop(t + dur + 0.05);
}

// --- Ville et nature --------------------------------------------------------------------------------------------------------

/** Envol d'une volée de pigeons : battements d'ailes (petites bouffées de bruit rapprochées) qui s'éloignent. */
export function flutter(kit: Kit, dest: AudioNode, t: number, birds: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const n = 10 + Math.min(birds, 8) * 2;
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.055 + rnd() * 0.04;
    burst(kit, out, at, "bandpass", 900 + rnd() * 700, 1.3, 0.7 * (1 - i / (n + 4)), 0.006, 0.035);
  }
}

/** Chant d'oiseau : merle (flûté, mélodieux), moineau (pépiements) ou mésange (« ti-tu ti-tu »), tiré au hasard. */
export function birdSong(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, spot);
  const species = rnd();
  if (species < 0.35) {
    // Merle : 4 à 7 notes flûtées entre 1,5 et 3 kHz, glissées.
    let at = t;
    const n = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const f0 = 1500 + rnd() * 1500, f1 = f0 * (0.8 + rnd() * 0.5), d = 0.09 + rnd() * 0.15;
      tone(kit, out, at, "sine", f0, f1, d, 0.18, 0.015, d);
      at += d + 0.03 + rnd() * 0.06;
    }
  } else if (species < 0.7) {
    // Moineau : « tchip » répétés.
    const n = 3 + Math.floor(rnd() * 5), f = 3200 + rnd() * 1500;
    for (let i = 0; i < n; i++) tone(kit, out, t + i * (0.13 + rnd() * 0.05), "sine", f * 1.25, f * 0.85, 0.05, 0.14, 0.004, 0.05);
  } else {
    // Mésange : deux notes alternées.
    const hi = 4800 + rnd() * 600, lo = hi * 0.72, n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      tone(kit, out, t + i * 0.32, "sine", hi, hi * 0.97, 0.08, 0.13, 0.005, 0.08);
      tone(kit, out, t + i * 0.32 + 0.15, "sine", lo, lo * 0.98, 0.08, 0.12, 0.005, 0.1);
    }
  }
}

/** Chouette hulotte : « hou… hou-hou-hou ». */
export function owl(kit: Kit, dest: AudioNode, t: number, spot: Spot): void {
  const out = spotOut(kit, dest, { ...spot, echo: Math.max(spot.echo, 0.3) });
  tone(kit, out, t, "sine", 470, 440, 0.6, 0.25, 0.05, 0.6);
  for (let i = 0; i < 4; i++) tone(kit, out, t + 1.4 + i * 0.22, "sine", 455, 430, 0.15, 0.18, 0.02, 0.17);
}

/**
 * Cloche (frappée une fois) : partiels d'une cloche d'église accordée (bourdon, fondamentale, tierce mineure, quinte, nominale…),
 * les graves sonnent le plus longtemps. `prime` : note de la cloche (Hz).
 */
export function bell(kit: Kit, dest: AudioNode, t: number, prime: number, spot: Spot, length = 1): void {
  const out = spotOut(kit, dest, spot);
  const partials = [[0.5, 0.5, 9], [1, 0.75, 6], [1.183, 0.55, 4.5], [1.5, 0.3, 3.5], [2, 0.9, 3], [2.51, 0.28, 1.8], [3.01, 0.22, 1.4], [4.17, 0.12, 0.9]] as const;
  for (const [r, a, d] of partials) tone(kit, out, t, "sine", prime * r, prime * r, 0, a * 0.35, 0.003, d * length);
  burst(kit, out, t, "bandpass", prime * 6, 2, 0.12, 0.001, 0.03);
}

/** Volée de midi : trois cloches qui sonnent à la suite pendant `seconds`. */
export function peal(kit: Kit, dest: AudioNode, t: number, seconds: number, spot: Spot): void {
  const primes = [262, 330, 392];
  let at = t;
  let i = 0;
  while (at < t + seconds) {
    bell(kit, dest, at, primes[i % 3]!, { ...spot, gain: spot.gain * (0.6 + rnd() * 0.25) }, 0.55);
    at += 0.42 + rnd() * 0.08;
    i += rnd() < 0.8 ? 1 : 2;
  }
}

// --- Interface et joueur -----------------------------------------------------------------------------------------------------

/** Petite mélodie : une suite de notes (Hz) jouées l'une après l'autre. */
export function jingle(kit: Kit, dest: AudioNode, t: number, notes: readonly number[], step: number, type: OscillatorType, gain: number): void {
  const out = spotOut(kit, dest, { gain, pan: 0, cutoff: 5000, echo: 0 });
  notes.forEach((f, i) => tone(kit, out, t + i * step, type, f, f, 0, 0.3, 0.005, step * 1.6));
}

/** Coup reçu par le joueur : coup sourd et souffle. */
export function hurt(kit: Kit, dest: AudioNode, t: number): void {
  const out = spotOut(kit, dest, { gain: 0.9, pan: 0, cutoff: 3000, echo: 0 });
  tone(kit, out, t, "sine", 120, 45, 0.15, 0.9, 0.002, 0.2);
  burst(kit, out, t, "lowpass", 700, 0.8, 0.4, 0.002, 0.1, true);
}

/** Mort du joueur : un son grave qui tombe. */
export function death(kit: Kit, dest: AudioNode, t: number): void {
  const out = spotOut(kit, dest, { gain: 0.8, pan: 0, cutoff: 2500, echo: 0.2 });
  tone(kit, out, t, "triangle", 220, 55, 1.6, 0.6, 0.05, 1.8);
  tone(kit, out, t, "sine", 330, 82, 1.6, 0.3, 0.05, 1.8);
  burst(kit, out, t, "lowpass", 400, 0.8, 0.3, 0.4, 1.2, true);
}
