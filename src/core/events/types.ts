import type { Recipe } from "../character";
import type { Crime } from "../wanted";

/**
 * Événements aléatoires (phase 4 du plaisir de jeu, `docs/plans/evenements.md`) : ce que les événements voient du monde et ce qu'ils y font.
 * Logique pure : le jeu branche le vrai monde (`src/game/events.ts`), les essais sans écran un faux ou le vrai (vraies données de navigation).
 */

/** Les identifiants des événements du catalogue (§ 3 du plan). */
export type EventKind = "vol" | "pickpocket" | "chien" | "accident" | "poursuite" | "malaise" | "rixe";

/** Les passants, vus par un événement : un sous-ensemble de `PedSim` (le jeu passe la vraie simulation). */
export interface EventPeds {
  readonly capacity: number;
  borrow(i: number): boolean;
  release(i: number): void;
  isBorrowed(i: number): boolean;
  command(i: number, kind: number, x: number, y: number, speed?: number, pose?: number): void;
  /** État (`PED_STATE`), −1 si l'emplacement est vide. */
  modeOf(i: number): number;
  position(i: number, out: { x: number; y: number }): void;
  headingOf(i: number): number;
  speedOf(i: number): number;
  idOf(i: number): number;
  attached(i: number): boolean;
  sitting(i: number): boolean;
  recipe(i: number): Recipe;
  setRecipe(i: number, recipe: Recipe): void;
  applyImpulse(i: number, ix: number, iy: number): void;
  /** Fait tomber le passant, même s'il trébuchait (plaquage). */
  tackle(i: number, ix: number, iy: number): void;
  queryCircle(x: number, y: number, r: number, out: number[]): number;
  alarm(x: number, y: number, radius: number, flee: number, except?: number): number;
}

/** Le joueur à cette image. */
export interface EventPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Vitesse (m/s), à pied ou au volant. */
  speed: number;
  /** À pied (ni au volant ni à la nage). */
  onFoot: boolean;
  /** Direction du regard de la caméra (rad, 0 = nord). */
  yaw: number;
}

/** Ce qu'un événement fait dans le monde : paroles, cris, argent, bandeau, infractions. Le jeu le branche sur l'interface, le son, le porte-monnaie, la police. */
export interface EventEffects {
  /** Bulle de parole au-dessus du passant `slot` pendant `seconds` s. */
  say(slot: number, text: string, seconds: number): void;
  /** Cri d'un passant en (x, y). */
  cry(kind: "scream" | "startled" | "hurt" | "oof", x: number, y: number): void;
  /** Gain (porte-monnaie : le « +180 € » monte à l'écran). */
  earn(amount: number, label: string): void;
  /** Bandeau d'exploit. */
  feat(text: string): void;
  /** Infraction du joueur en (x, y), signalée par les passants si la police ne la voit pas. */
  crime(kind: Crime, x: number, y: number): void;
}

/** Ce qu'un événement sait du monde à chaque image, en plus des passants. */
export interface EventContext {
  /** Pas de temps (s, temps du jeu). */
  dt: number;
  player: EventPlayer;
  /** Le point (x, y) est-il à l'écran (dans le champ de la caméra, sans mur entre elle et lui) ? */
  visible(x: number, y: number): boolean;
  /** Une voiture de police ou un gendarme à moins de `r` m de (x, y) ? */
  policeNear(x: number, y: number, r: number): boolean;
  /** Rien (mur, bâtiment) entre (x0, y0) et (x1, y1) ? Absent : on ne vérifie pas. */
  lineClear?(x0: number, y0: number, x1: number, y1: number): boolean;
}

/** Repère sur la minimap et la carte : la scène (« ! » ocre), un fuyard (point rouge), quelqu'un à rejoindre (point ocre). */
export interface EventMarker {
  kind: "scene" | "fugitive" | "meet";
  x: number;
  y: number;
}

/** Objet au sol que l'événement fait dessiner : le sac volé, des billets (pickpocket). */
export interface GroundItem {
  kind: "bag" | "cash";
  x: number;
  y: number;
  /** Couleur de l'objet (entier 0xRRGGBB). */
  color: number;
}

/** Bouton contextuel proposé par un événement (« Rendre le sac »…) : son texte et ce qu'il fait. */
export interface EventAction {
  /** Libellé complet (« Rendre le sac ») et verbe court du bouton rond (« Rendre »). */
  label: string;
  verb: string;
  /** Pictogramme du bouton (sac par défaut). */
  icon?: "bag" | "dog";
  run(): void;
}

/** Comment un événement s'est terminé, pour le journal et les comptes du carnet. */
export type EventOutcome = "rendu" | "garde" | "rattrape" | "enfui" | "perdu" | "abandonne";

/** Un événement en cours : une machine à états avancée par le directeur. */
export interface GameEvent {
  readonly kind: EventKind;
  /** Grand événement (police, plusieurs voitures) : un seul à la fois. */
  readonly big: boolean;
  /** Où se passe la scène (repère, journal). */
  readonly x: number;
  readonly y: number;
  /** Fini : le directeur le retire après `cleanup`. */
  readonly done: boolean;
  readonly outcome: EventOutcome | null;
  /** Le joueur y a fait une bonne action (sac rendu…) : compté au carnet. */
  readonly goodDeed: boolean;
  update(ctx: EventContext): void;
  markers(out: EventMarker[]): void;
  items(out: GroundItem[]): void;
  /** Bouton contextuel proposé au joueur à cette image, ou null. */
  action(player: EventPlayer): EventAction | null;
  /** Le passant `slot` est-il un fuyard qu'on peut arrêter sans infraction (voleur, D5 du plan) ? */
  lawfulTarget(slot: number): boolean;
  /** Arrêt immédiat (mort, arrestation, réglage) : tout ce qui est réquisitionné est rendu. */
  abort(): void;
}

/** Tirage pseudo-aléatoire reproductible (mulberry32) : `next()` dans [0, 1[. */
export class EventRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Entier dans [a, b], arrondi à `step` près. */
  between(a: number, b: number, step = 1): number {
    return Math.round((a + this.next() * (b - a)) / step) * step;
  }
}
