/**
 * Banc de test (D284) : d'où viennent les images lentes ? Deux sources, mises côte à côte pour chaque image de plus de 33 ms :
 * - le temps de chaque partie de la boucle du banc (tuiles, passants, rendu…), mesuré par `HitchProbe.mark` ;
 * - les « Long Animation Frames » de Chrome (Chrome 123 et plus) : tout le code qui a tourné pendant l'image, y compris hors de la boucle
 *   (lecture d'un fichier reçu, promesses), avec la fonction et la position dans le fichier construit.
 * Analogie : le chronomètre de chaque poste d'une chaîne de montage (la boucle), et la caméra de surveillance de l'atelier (Chrome) qui
 * voit aussi ce qui se passe hors de la chaîne. Ce qu'aucun des deux ne voit (ramasse-miettes hors de nos fonctions, attente du GPU,
 * composition de la page) reste en « hors mesure ».
 */

/** Parties de la boucle du banc, dans l'ordre où elles tournent. */
export const SECTIONS = ["tuiles", "flotte", "navigation", "circulation", "décor", "minimap", "passants", "pigeons", "foule", "rendu"] as const;
export type Section = (typeof SECTIONS)[number];

/** Image lente : quand (s depuis le début de la phase), durée, construction de tuile, temps de chaque partie et des scripts vus par Chrome. */
export interface HitchFrame {
  at: number;
  ms: number;
  build: number;
  sections: Partial<Record<Section, number>>;
  /** Somme des parties mesurées de la boucle (ms). */
  work: number;
  /** Scripts vus par Chrome pendant cette image (les trois plus longs), « type · fonction · fichier:position durée ». */
  scripts: string[];
}

export interface ScriptCost {
  /** Type d'appel (rappel d'image, promesse, événement) · fonction · fichier:position dans le fichier construit. */
  key: string;
  ms: number;
  count: number;
  max: number;
}

export interface HitchReport {
  /** Images de plus de 33 ms. */
  count: number;
  /** Les plus lentes (au plus `MAX_FRAMES`), dans l'ordre du temps. */
  frames: HitchFrame[];
  /** Sur toutes les images lentes : temps total de chaque partie (ms), et ce qui ne tombe dans aucune (durée − travail mesuré − 16,7 ms d'une image normale). */
  sections: Partial<Record<Section, number>>;
  outside: number;
  /** Chrome : nombre d'images longues signalées (> 50 ms), temps bloquant total, scripts les plus coûteux ; null si le navigateur ne les signale pas. */
  loaf: { count: number; blockingMs: number; renderMs: number; scripts: ScriptCost[] } | null;
}

const SLOW_MS = 33.4;
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 40;
const MAX_SCRIPTS = 12;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Ce que le banc garde d'une entrée « long-animation-frame » (sous-ensemble de l'API de Chrome). */
export interface LoafEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  renderStart: number;
  scripts: { invokerType: string; invoker: string; sourceFunctionName: string; sourceURL: string; sourceCharPosition: number; duration: number }[];
}

export function scriptKey(s: LoafEntry["scripts"][number]): string {
  const file = s.sourceURL.split("/").pop()?.split("?")[0] ?? "";
  return `${s.invokerType} · ${s.sourceFunctionName || s.invoker || "?"} · ${file}:${s.sourceCharPosition}`;
}

/** Regroupe les scripts des entrées de Chrome par fonction, du plus coûteux au moins coûteux. */
export function summarizeLoaf(entries: readonly LoafEntry[]): NonNullable<HitchReport["loaf"]> {
  const by = new Map<string, ScriptCost>();
  let blockingMs = 0, renderMs = 0;
  for (const e of entries) {
    blockingMs += e.blockingDuration;
    if (e.renderStart > 0) renderMs += e.startTime + e.duration - e.renderStart;
    for (const s of e.scripts) {
      const key = scriptKey(s);
      const c = by.get(key) ?? { key, ms: 0, count: 0, max: 0 };
      c.ms += s.duration;
      c.count++;
      c.max = Math.max(c.max, s.duration);
      by.set(key, c);
    }
  }
  const scripts = [...by.values()].sort((a, b) => b.ms - a.ms).slice(0, MAX_SCRIPTS).map((c) => ({ ...c, ms: r1(c.ms), max: r1(c.max) }));
  return { count: entries.length, blockingMs: r1(blockingMs), renderMs: r1(renderMs), scripts };
}

/** Résume les images lentes d'une phase : les `MAX_FRAMES` plus lentes, et le total par partie. */
export function summarizeHitches(frames: readonly HitchFrame[], loaf: readonly LoafEntry[] | null): HitchReport {
  const sections: Partial<Record<Section, number>> = {};
  let outside = 0;
  for (const f of frames) {
    for (const k of SECTIONS) if (f.sections[k]) sections[k] = (sections[k] ?? 0) + f.sections[k]!;
    outside += Math.max(0, f.ms - f.work - FRAME_MS);
  }
  for (const k of SECTIONS) if (sections[k] !== undefined) sections[k] = r1(sections[k]!);
  const kept = [...frames].sort((a, b) => b.ms - a.ms).slice(0, MAX_FRAMES).sort((a, b) => a.at - b.at);
  return { count: frames.length, frames: kept, sections, outside: r1(outside), loaf: loaf ? summarizeLoaf(loaf) : null };
}

/**
 * Chronomètre des parties de la boucle, image par image. `begin` au début de l'image, `mark(partie)` après chaque partie ; à l'image
 * suivante, `sample(durée, construction)` garde l'image précédente si elle a été lente (la durée mesurée en début d'image est celle de
 * l'image précédente, comme dans le banc).
 */
export class HitchProbe {
  private t = 0;
  private current: Partial<Record<Section, number>> = {};
  private previous: Partial<Record<Section, number>> = {};
  private frames: HitchFrame[] = [];
  private loaf: LoafEntry[] = [];
  private readonly observer: PerformanceObserver | null = null;
  private phaseStart = 0;

  constructor(private readonly now: () => number = () => performance.now()) {
    try {
      if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as LoafEntry[]) {
            this.loaf.push({
              startTime: e.startTime, duration: e.duration, blockingDuration: e.blockingDuration, renderStart: e.renderStart,
              scripts: e.scripts.map((s) => ({ invokerType: s.invokerType, invoker: s.invoker, sourceFunctionName: s.sourceFunctionName, sourceURL: s.sourceURL, sourceCharPosition: s.sourceCharPosition, duration: s.duration })),
            });
          }
          if (this.loaf.length > 4000) this.loaf.splice(0, this.loaf.length - 4000);
        });
        this.observer.observe({ type: "long-animation-frame", buffered: false });
      }
    } catch {
      /* navigateur sans « long-animation-frame » : seul le chronomètre de la boucle compte */
    }
  }

  /** Les images longues de Chrome sont-elles signalées par ce navigateur ? */
  get hasLoaf(): boolean {
    return this.observer !== null;
  }

  /** Nouvelle phase mesurée : on oublie tout ce qui précède. */
  reset(): void {
    this.frames = [];
    this.loaf = [];
    this.phaseStart = this.now();
  }

  begin(): void {
    this.previous = this.current;
    this.current = {};
    this.t = this.now();
  }

  mark(section: Section): void {
    const t = this.now();
    this.current[section] = (this.current[section] ?? 0) + (t - this.t);
    this.t = t;
  }

  /** Durée de l'image précédente (ms) et sa construction de tuile (ms) : gardée si elle est lente. */
  sample(ms: number, build: number): void {
    if (ms <= SLOW_MS) return;
    const sections: Partial<Record<Section, number>> = {};
    let work = 0;
    for (const k of SECTIONS) {
      const v = this.previous[k];
      if (v === undefined) continue;
      work += v;
      if (v >= 0.5) sections[k] = r1(v);
    }
    // L'image précédente s'est terminée au début de celle-ci : les scripts de Chrome qui y tombent.
    const end = this.now(), start = end - ms;
    const scripts = this.loaf
      .filter((e) => e.startTime < end && e.startTime + e.duration > start)
      .flatMap((e) => e.scripts)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map((s) => `${scriptKey(s)} ${r1(s.duration)}`);
    this.frames.push({ at: r1((start - this.phaseStart) / 1000), ms: r1(ms), build: r1(build), sections, work: r1(work), scripts });
  }

  report(): HitchReport {
    const t0 = this.phaseStart;
    return summarizeHitches(this.frames, this.observer ? this.loaf.filter((e) => e.startTime >= t0) : null);
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}

/** Lignes du rapport texte pour une phase. */
export function hitchLines(h: HitchReport): string[] {
  if (!h.count) return [];
  const lines: string[] = [];
  const parts = SECTIONS.filter((k) => (h.sections[k] ?? 0) >= 1).map((k) => `${k} ${Math.round(h.sections[k]!)}`);
  lines.push(`  Images lentes (${h.count}) : temps passé dedans, en ms : ${parts.join(" · ") || "rien de notable"} · hors mesure ${Math.round(h.outside)}`);
  if (h.loaf) {
    lines.push(`  Chrome : ${h.loaf.count} images longues (> 50 ms) · ${Math.round(h.loaf.blockingMs)} ms bloquants · ${Math.round(h.loaf.renderMs)} ms de rendu de la page`);
    for (const s of h.loaf.scripts.slice(0, 5)) lines.push(`    ${s.key} : ${Math.round(s.ms)} ms en ${s.count} fois (pire ${Math.round(s.max)})`);
  } else lines.push("  Chrome : images longues non signalées par ce navigateur");
  return lines;
}
