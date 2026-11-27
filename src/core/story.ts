/**
 * Histoire, prologue « Le retour » (D338) : parti d'Autun depuis dix ans, le personnage revient par le train ; Jojo, un ami d'enfance,
 * l'attend au café du Champ de Mars et lui apprend que sa vieille dette n'est pas oubliée. Logique pure : étapes, textes, déclencheurs ;
 * le jeu (`src/game/arrival.ts`) affiche ce qu'elle lui demande.
 *
 * Étapes : `arrivee` (cinématique de la gare), `rejoindre` (aller voir Jojo), `fin` (prologue terminé ; les missions viendront plus tard).
 */

export type StoryStep = "arrivee" | "rejoindre" | "fin";
const STEPS: readonly StoryStep[] = ["arrivee", "rejoindre", "fin"];

/** Ce que la sauvegarde garde de l'histoire (champ facultatif `story` de la version 6). */
export interface SavedStory {
  step: StoryStep;
}

/** État de l'histoire lu avec méfiance : une étape connue, sinon rien. */
export function parseStory(o: unknown): SavedStory | null {
  if (!o || typeof o !== "object") return null;
  const step = (o as Record<string, unknown>)["step"];
  return typeof step === "string" && (STEPS as readonly string[]).includes(step) ? { step: step as StoryStep } : null;
}

/** Jojo, sur le trottoir devant le café du Champ de Mars (à 2,2 m de la façade du Commerce), tourné vers la place. */
export const JOJO = { x: -19.1, y: 14.9, heading: 0.99, name: "Jojo" } as const;
/** Distance (m) à laquelle Jojo voit arriver le joueur et lui parle. */
export const MEET_RADIUS = 4.5;

/** Textes du prologue, réunis ici pour la relecture. */
export const STORY_TEXT = {
  place: "Autun — gare SNCF",
  /** Carton de la cinématique : la date est complétée par le jeu (jour et heure). */
  sms: "T'es vraiment revenu ? Dix ans… Je t'attends au café du Champ de Mars. Fais gaffe, y en a qui t'ont pas oublié.",
  objective: "Rejoins Jojo au café du Champ de Mars.",
  lines: [
    "Regarde-toi ! Le revenant.",
    "Le Gros sait que t'es là. Ta dette, il l'a pas oubliée, lui.",
    "Va falloir trouver de l'argent. Vite.",
  ],
  end: { title: "Prologue terminé", sub: "La suite au prochain épisode" },
} as const;

/** Délai (s) entre la fin de la cinématique et le SMS de Jojo (après la fiche de la gare, découverte à la descente du train) ; durée de chaque réplique ; temps avant le bandeau de fin. */
const SMS_DELAY = 8;
const LINE_SECONDS = 4;

/** Ce que le prologue demande au jeu. */
export type StoryAction =
  | { kind: "sms"; from: string; text: string }
  | { kind: "objective"; text: string }
  | { kind: "waypoint"; at: { x: number; y: number } | null }
  | { kind: "say"; text: string; seconds: number }
  | { kind: "banner"; title: string; sub: string }
  | { kind: "save" };

export class Prologue {
  step: StoryStep;
  private smsIn = -1;
  /** Temps écoulé depuis le début de la rencontre avec Jojo (s), −1 avant. */
  private meeting = -1;
  private said = 0;
  /** Actions à rejouer au premier `update` (reprise d'une partie à l'étape `rejoindre`). */
  private pending: StoryAction[] = [];

  /**
   * `saved` : l'histoire de la sauvegarde ; `fresh` : nouvelle partie (départ à la gare). Une partie d'avant l'histoire (sauvegarde sans
   * `story`) est traitée comme un prologue terminé : pas de cinématique au milieu d'une partie.
   */
  constructor(saved: SavedStory | null, fresh: boolean) {
    this.step = saved?.step ?? (fresh ? "arrivee" : "fin");
    // Reprise pendant la cinématique (partie enregistrée à ce moment-là) : on la saute, le joueur est déjà sur le quai.
    if (!fresh && this.step === "arrivee") this.step = "rejoindre";
    if (!fresh && this.step === "rejoindre") this.pending = this.goal();
  }

  /** Jojo est-il là ? Jusqu'à la fin de la rencontre. */
  get jojoHere(): boolean {
    return this.step !== "fin" || this.meeting >= 0;
  }

  /** La rencontre est en cours (le jeu peut tourner Jojo vers le joueur). */
  get talking(): boolean {
    return this.meeting >= 0;
  }

  toSave(): SavedStory {
    return { step: this.step };
  }

  /** La cinématique est finie (ou passée) : Jojo écrira bientôt. */
  introDone(): StoryAction[] {
    if (this.step !== "arrivee") return [];
    this.step = "rejoindre";
    this.smsIn = SMS_DELAY;
    return [{ kind: "save" }];
  }

  /** À chaque image : `x`, `y` du joueur. Rend ce que le jeu doit afficher maintenant. */
  update(dt: number, x: number, y: number): StoryAction[] {
    const out = this.pending;
    this.pending = [];
    if (this.step === "rejoindre" && this.smsIn >= 0 && (this.smsIn -= dt) < 0) {
      out.push({ kind: "sms", from: JOJO.name, text: STORY_TEXT.sms }, ...this.goal(), { kind: "save" });
    }
    if (this.step === "rejoindre" && this.meeting < 0 && this.smsIn < 0 && Math.hypot(x - JOJO.x, y - JOJO.y) <= MEET_RADIUS) {
      this.meeting = 0;
      this.said = 0;
      out.push({ kind: "waypoint", at: null });
    }
    if (this.meeting >= 0) {
      this.meeting += dt;
      while (this.said < STORY_TEXT.lines.length && this.meeting >= this.said * LINE_SECONDS) {
        out.push({ kind: "say", text: STORY_TEXT.lines[this.said]!, seconds: LINE_SECONDS - 0.3 });
        this.said++;
      }
      if (this.step === "rejoindre" && this.meeting >= STORY_TEXT.lines.length * LINE_SECONDS) {
        this.step = "fin";
        out.push({ kind: "banner", ...STORY_TEXT.end }, { kind: "save" });
      }
      // Jojo reste un moment après le bandeau, puis la rencontre est close.
      if (this.meeting >= STORY_TEXT.lines.length * LINE_SECONDS + 20) this.meeting = -1;
    }
    return out;
  }

  /** Objectif et repère de l'étape `rejoindre`. */
  private goal(): StoryAction[] {
    return [{ kind: "objective", text: STORY_TEXT.objective }, { kind: "waypoint", at: { x: JOJO.x, y: JOJO.y } }];
  }
}
