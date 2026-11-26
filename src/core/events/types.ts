import type { Recipe } from "../character";
import type { Crime } from "../wanted";

/**
 * Événements aléatoires (phase 4 du plaisir de jeu, `docs/plans/evenements.md`) : ce que les événements voient du monde et ce qu'ils y font.
 * Logique pure : le jeu branche le vrai monde (`src/game/events.ts`), les essais sans écran un faux ou le vrai (vraies données de navigation).
 */

/** Les identifiants des événements du catalogue (§ 3 du plan). */
export type EventKind = "vol" | "pickpocket" | "chien" | "accident" | "poursuite" | "malaise" | "rixe" | "enerve" | "livreur" | "chauffard" | "mariage" | "feu";

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
  /** Fait apparaître quelqu'un debout, réquisitionné (voir `PedSim.appear`) ; −1 sans file piétonne proche. */
  appear(x: number, y: number, seed: number, heading: number, recipe?: Recipe | null): number;
  /** Le passant disparaît (il monte en voiture). */
  vanish(i: number): void;
  /** Fait tomber le passant, même s'il trébuchait (plaquage). */
  tackle(i: number, ix: number, iy: number): void;
  queryCircle(x: number, y: number, r: number, out: number[]): number;
  alarm(x: number, y: number, radius: number, flee: number, except?: number): number;
}

/** Une voiture d'événement (phase 4 : accident, poursuite), vue par l'événement. */
export interface EventCarView {
  id: number;
  state: { x: number; y: number; vx: number; vy: number; heading: number; speed: number };
  police: boolean;
  /** Graine du conducteur (celui qui descend). */
  driver: number;
  /** Trop abîmée : son conducteur l'abandonne ; choc avec le véhicule du joueur au dernier pas (m/s). */
  abandoned?: boolean;
  hit?: number;
  /** Autre voiture touchée au dernier pas (−1 sans), impact (m/s) ; santé de la carrosserie (100 neuve) ; modèle. */
  hitCar?: number;
  hitCarImpact?: number;
  health?: number;
  model?: string;
}

/** La circulation, vue par un événement : un sous-ensemble de `Traffic` (le jeu passe la vraie). */
export interface EventTraffic {
  /** Pose une voiture arrêtée ; `opts` : modèle, peinture imposés (la voiture blanche des mariés). */
  stage(x: number, y: number, heading: number, seed: number, opts?: { model?: string; paint?: string }): EventCarView | null;
  /** Le joueur vient d'accrocher une voiture civile à faible vitesse : laquelle (null sinon). */
  takeBump(min: number, max: number): { id: number; speed: number } | null;
  spawnEvent(police: boolean, around?: { x: number; y: number }, model?: string): EventCarView | null;
  eventCar(id: number): EventCarView | null;
  pursue(id: number, target: { x: number; y: number; vx: number; vy: number } | null): void;
  /** Gyrophares (et sirène, sauf `sound` faux : garée sur une scène). */
  setSiren(id: number, on: boolean, sound?: boolean): void;
  setHazard(id: number, on: boolean): void;
  setNoDriver(id: number, on: boolean): void;
  hold(id: number, seconds: number): void;
  letGo(id: number): void;
  drop(id: number): void;
  carsNear(x: number, y: number, r: number): number;
  /** Conducteur en fuite : conduite de poursuite et itinéraire vers (x, y) ; faux sans itinéraire. */
  /** `maxExpand` : borne de la recherche d'itinéraire (un but proche n'a pas besoin des 4 000 sens par défaut ; un but injoignable les épuise). */
  planTo(id: number, x: number, y: number, chase?: boolean, wrongWay?: boolean, maxExpand?: number): boolean;
  /** Prend une voiture qui roule déjà (null : police, service, déjà prise) ; les voitures civiles libres autour d'un point. */
  claim(id: number): EventCarView | null;
  freeCars(x: number, y: number, r: number): EventCarView[];
  /** Cabosse la voiture `id` (points de dégâts) du côté du point (fromX, fromY). */
  dent(id: number, points: number, fromX: number, fromY: number): void;
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
  /** `fire` : un feu (poubelle) ; `color` sert alors de force (0 à 1 : 0, seulement de la fumée). */
  kind: "bag" | "cash" | "fire";
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
  icon?: "bag" | "dog" | "help" | "separate";
  run(): void;
}

/** Comment un événement s'est terminé, pour le journal et les comptes du carnet. */
export type EventOutcome = "rendu" | "garde" | "rattrape" | "enfui" | "perdu" | "abandonne" | "constat" | "vole" | "termine" | "arrete" | "secouru" | "soigne" | "evacue" | "separe" | "disperse" | "excuse" | "parti" | "frappe" | "livre" | "choc" | "grille" | "cortege" | "eteint";

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
