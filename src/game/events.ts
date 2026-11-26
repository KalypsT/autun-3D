import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { EventBook, eventGoal, type EventTierHit } from "../core/events/book";
import { eventCatalog } from "../core/events/catalog";
import { ENERVE } from "../core/events/enerve";
import { EventDirector, outcomeText, type DirectorContext, type EventEnd } from "../core/events/director";
import type { EventAction, EventKind, EventMarker, EventPlayer, EventTraffic, GroundItem } from "../core/events/types";
import type { NavGraph } from "../core/nav-graph";
import type { RoadGraph } from "../core/road-graph";
import type { Crime } from "../core/wanted";
import { TIER_NAMES } from "../core/challenges";
import { SpeechBubbles } from "../ui/speech";
import type { PedsController } from "./peds-controller";

/** Ce que le contrôleur des événements demande au jeu. */
export interface EventsHost {
  peds(): PedsController | null;
  camera: THREE.PerspectiveCamera;
  colliders: Colliders;
  /** Positions des voitures de police et des gendarmes à pied (pour ne pas voler sous leur nez). */
  policeAt(visit: (x: number, y: number) => void): void;
  cry(kind: "scream" | "startled" | "hurt" | "oof", x: number, y: number, slot: number): void;
  earn(amount: number, label: string): void;
  /** Prend au porte-monnaie (sans dette) ; renvoie ce qui a été pris. */
  take(amount: number, label: string): number;
  /** Solde du joueur (€). */
  money(): number;
  /** Haut de la tête du joueur (repère du jeu), pour une bulle au-dessus de lui. */
  playerHead(): { x: number; y: number; z: number };
  /** Aboiement en (x, y) ; klaxon d'une voiture en (x, y). */
  bark(x: number, y: number): void;
  honk(x: number, y: number): void;
  /** Le joueur un genou à terre (il porte secours), ou debout. */
  kneel(on: boolean): void;
  /** Un coup de poing reçu par le joueur (rixe) : points de vie, depuis (x, y). */
  hurtPlayer(damage: number, x: number, y: number): void;
  /** Applaudissements, volée de cloches (le mariage). */
  applause(x: number, y: number, seconds: number): void;
  bells(x: number, y: number, seconds: number): void;
  /** Un PNJ tire sur le joueur (le braqueur) : rendu du tir, son, points de vie ; son arme lâchée au sol ; l'alarme du commerce. */
  shoot(x0: number, y0: number, x1: number, y1: number, hit: boolean, damage: number): void;
  dropGun(x: number, y: number): void;
  shopAlarm(x: number, y: number, seconds: number): void;
  /** Commerces ouverts en ce moment. */
  openShops(): readonly { x: number; y: number }[];
  /** Corbeilles de rue des tuiles chargées (le feu de poubelle). */
  bins(): readonly { x: number; y: number }[];
  /** Bars, cafés et restaurants (repère du jeu ; vide tant que la carte n'est pas chargée). */
  bars(): readonly { x: number; y: number }[];
  /** La circulation (null sans), le graphe routier (null tant que la navigation n'est pas chargée). */
  traffic(): EventTraffic | null;
  road(): RoadGraph | null;
  /** Le graphe piéton (null tant que la navigation n'est pas chargée). */
  pedNav(): NavGraph | null;
  feat(text: string): void;
  crime(kind: Crime, x: number, y: number): void;
  /** Nom de la rue la plus proche (« rue aux Cordiers »), ou null. */
  street(x: number, y: number): string | null;
}

/** Ce que le jeu sait du moment, à chaque image. */
export interface EventsFrame {
  player: EventPlayer;
  hour: number;
  date: number;
  weekday: number;
  rain: number;
  stars: number;
  blocked: boolean;
  traffic: boolean;
}

/** Au-delà de cette distance (m) de la caméra, un point n'est plus « à l'écran » (un passant n'y fait que quelques pixels). */
const VIEW_RANGE = 140;

/**
 * Les événements dans le jeu (phase 4) : le directeur et le catalogue (logique pure, `src/core/events/`), branchés sur la vraie foule, la caméra,
 * le son, le porte-monnaie, la police et l'interface (bulles, minimap, bouton contextuel, carnet « Faits divers »).
 */
export class EventsController {
  readonly director: EventDirector;
  readonly book: EventBook;
  readonly markers: EventMarker[] = [];
  readonly items: GroundItem[] = [];
  private readonly bubbles: SpeechBubbles;
  private readonly ends: EventEnd[] = [];
  private readonly ctx: DirectorContext;
  private readonly v = new THREE.Vector3();
  private sim: ReturnType<PedsController["eventPeds"]> = null;
  /** Événement imposé par `?event=` : on réessaie jusqu'à trouver un lieu (la foule met quelques secondes à se remplir). */
  private forced: EventKind | null = null;
  private forceTry = 0;
  /** Le conducteur énervé : pas avant … s ; la voiture accrochée pendant qu'on le lance. */
  private bumpCool = 0;
  private pendingBump = -1;
  /** Coût moyen (ms, lissé) d'une image, pour la ligne de diagnostic. */
  ms = 0;

  constructor(private readonly host: EventsHost, seed: number, saved: EventBook | null, forced: string | null) {
    this.director = new EventDirector(seed);
    this.book = saved ?? new EventBook();
    this.bubbles = new SpeechBubbles(document.body);
    const fx = {
      say: (slot: number, text: string, seconds: number) => this.say(slot, text, seconds),
      cry: (kind: "scream" | "startled" | "hurt" | "oof", x: number, y: number) => host.cry(kind, x, y, Math.floor(Math.abs(x * 7 + y * 13))),
      earn: (n: number, label: string) => host.earn(n, label),
      take: (n: number, label: string) => host.take(n, label),
      sayPlayer: (text: string, seconds: number) => this.bubbles.say(-1, text, seconds, () => host.playerHead()),
      bark: (x: number, y: number) => host.bark(x, y),
      honk: (x: number, y: number) => host.honk(x, y),
      kneel: (on: boolean) => host.kneel(on),
      hurtPlayer: (n: number, x: number, y: number) => host.hurtPlayer(n, x, y),
      applause: (x: number, y: number, t: number) => host.applause(x, y, t),
      bells: (x: number, y: number, t: number) => host.bells(x, y, t),
      shoot: (x0: number, y0: number, x1: number, y1: number, hit: boolean, damage: number) => host.shoot(x0, y0, x1, y1, hit, damage),
      dropGun: (x: number, y: number) => host.dropGun(x, y),
      alarm: (x: number, y: number, t: number) => host.shopAlarm(x, y, t),
      feat: (t: string) => host.feat(t),
      crime: (k: Crime, x: number, y: number) => host.crime(k, x, y),
    };
    const world = { peds: () => this.sim, dogs: () => (this.sim ? host.peds() : null), money: () => host.money(), traffic: () => host.traffic(), road: () => host.road(), pedNav: () => host.pedNav(), bars: () => host.bars(), bins: () => host.bins(), openShops: () => host.openShops(), pendingBump: () => this.pendingBump, fx };
    for (const def of eventCatalog(world)) this.director.register(def);
    if (forced && this.director.defOf(forced as EventKind)) this.forced = forced as EventKind;
    const cam = host.camera;
    this.ctx = {
      dt: 0, player: { x: 0, y: 0, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 },
      // À l'écran : dans le champ de la caméra (marge de 10 %), à moins de 140 m, sans mur entre elle et le point.
      visible: (x, y) => {
        const v = this.v.set(x, 1, -y).project(cam);
        if (v.z > 1 || Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.95) return false;
        const cx = cam.position.x, cy = -cam.position.z;
        if (Math.hypot(x - cx, y - cy) > VIEW_RANGE) return false;
        return host.colliders.raycast(cx, cy, x, y) === null;
      },
      policeNear: (x, y, r) => {
        let near = false;
        host.policeAt((px, py) => {
          if (!near && Math.hypot(px - x, py - y) < r) near = true;
        });
        return near;
      },
      lineClear: (x0, y0, x1, y1) => host.colliders.raycast(x0, y0, x1, y1) === null,
      hour: 12, weekday: 0, rain: 0, zone: 0, stars: 0, blocked: false, crowd: false, traffic: false,
    };
  }

  /** Bulle au-dessus de la tête du passant `slot` (s'il est toujours le même : un emplacement réutilisé n'a plus la parole). */
  private say(slot: number, text: string, seconds: number): void {
    const sim = this.sim;
    if (!sim) return;
    const id = sim.idOf(slot), st = sim.state;
    this.bubbles.say(slot, text, seconds, () => {
      if (!st.alive![slot] || sim.idOf(slot) !== id) return null;
      return { x: st.x[slot]!, y: -st.z[slot]!, z: st.y[slot]! + st.recipes[slot]!.height };
    });
  }

  /** Réglage « Événements » (0 à 3). */
  setLevel(level: number): void {
    if (level === this.director.level) return;
    this.director.level = level;
    if (level === 0) this.clear();
  }

  /** Mort, arrestation, nouvelle partie : tout s'arrête, calme d'une minute. */
  reset(): void {
    this.director.reset();
    this.bubbles.clear();
  }

  clear(): void {
    this.director.clear();
    this.bubbles.clear();
  }

  update(dt: number, f: EventsFrame): EventTierHit[] {
    const t0 = performance.now();
    const peds = this.host.peds();
    const sim = peds?.eventPeds() ?? null;
    // La foule a été refabriquée (réglage « Foule ») : les passants réquisitionnés n'existent plus.
    if (sim !== this.sim) {
      if (this.sim) this.clear();
      this.sim = sim;
    }
    const c = this.ctx;
    c.dt = dt;
    Object.assign(c.player, f.player);
    c.hour = f.hour;
    c.weekday = f.weekday;
    c.rain = f.rain;
    c.zone = peds?.stats?.zone ?? 2;
    c.stars = f.stars;
    c.blocked = f.blocked;
    c.crowd = !!sim && peds!.capacity > 0;
    c.traffic = f.traffic;
    this.director.date = f.date;
    this.director.hour = f.hour;
    if (this.forced && sim && (this.forceTry -= dt) <= 0) {
      this.forceTry = 0.5;
      if (this.director.force(this.forced, c)) this.forced = null;
    }
    // Le joueur accroche une voiture de la circulation (choc léger) : une fois sur quatre, son conducteur s'énerve (E8, D334).
    this.bumpCool -= dt;
    const bump = this.bumpCool <= 0 ? this.host.traffic()?.takeBump(ENERVE.bumpMin, ENERVE.bumpMax) : null;
    if (bump && this.director.level > 0 && !c.blocked && c.stars === 0 && sim && !f.player.onFoot && !this.director.active.some((e) => !e.big)) {
      if (Math.random() < ENERVE.chance) {
        this.pendingBump = bump.id;
        if (this.director.force("enerve", c)) this.bumpCool = ENERVE.cooldown;
        this.pendingBump = -1;
      } else this.bumpCool = 3;
    }
    this.director.update(c);
    const hits: EventTierHit[] = [];
    this.ends.length = 0;
    this.director.takeEnds(this.ends);
    for (const e of this.ends) {
      hits.push(...this.book.record(e));
      const j = this.director.journal[this.director.journal.length - 1];
      if (j && j.kind === e.kind) {
        const street = this.host.street(j.x, j.y);
        this.book.note(j.date, j.hour, `${j.label}${street ? `, ${street}` : ""} · ${outcomeText(e.kind, e.outcome)}`);
      }
    }
    this.markers.length = 0;
    this.items.length = 0;
    for (const e of this.director.active) {
      e.markers(this.markers);
      e.items(this.items);
    }
    this.bubbles.update(dt, this.host.camera, window.innerWidth, window.innerHeight);
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
    return hits;
  }

  /** Bouton contextuel proposé par un événement en cours, ou null. */
  action(player: EventPlayer): EventAction | null {
    for (const e of this.director.active) {
      const a = e.action(player);
      if (a) return a;
    }
    return null;
  }

  lawful(slot: number): boolean {
    return this.director.lawfulTarget(slot);
  }

  /** Texte d'un palier franchi (bandeau). */
  static tierText(h: EventTierHit): string {
    return `Défi ${TIER_NAMES[h.tier - 1]} : ${eventGoal(h.id, h.goal)}`;
  }

  /** Ligne de diagnostic (`?debug`). */
  debug(): string {
    const d = this.director, a = d.active.map((e) => e.kind).join("+") || "—";
    return ` · événements ${a} (${d.starts} lancés, ${d.misses} sans lieu, ${this.ms.toFixed(2)} ms)`;
  }
}
