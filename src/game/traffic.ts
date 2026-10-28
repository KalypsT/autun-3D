import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { MASK_ZONE, type Observer, type TrafficBody } from "../core/pedestrians";
import type { Signals } from "../core/signals";
import { trafficTarget } from "../core/traffic-density";
import { pickSpawn, spawnRing, visibleFrom } from "../core/traffic-spawn";
import { TrafficSim, type PedLookup, type PlayerBody, type SimCar } from "../core/traffic-sim";
import { CATALOG, paletteColor, type VehicleDef } from "../core/vehicle-catalog";
import { pickModel } from "../core/vehicle-placement";
import { ZONE } from "../data/nav";
import type { HeightField } from "../data/types";
import { TrafficModels, type TrafficItem } from "../render/traffic-models";
import type { NavManager } from "./nav-manager";

/**
 * Circulation du jeu (étape J3) : la simulation (`src/core/traffic-sim.ts`), un modèle articulé par voiture (le rendu par instances est J3-5),
 * et la vie de la couronne autour du joueur (D64) : naissance hors de sa vue selon l'heure et le quartier, disparition au loin, remplacement
 * des voitures perdues. Rien n'est sauvegardé : la circulation renaît autour du joueur.
 */

interface TrafficCar {
  sim: SimCar;
  def: VehicleDef;
  variant: number;
  /** Ce que voient les passants de cette voiture (position, vitesse, coque) et ce que le choc d'un passant lui a coûté. */
  body: TrafficBody;
  /** Depuis combien de secondes le conducteur est perdu (le joueur la regardait : elle n'a pas pu disparaître). */
  lostFor: number;
}

/** Ce que la circulation sait du joueur à chaque image : position, cap de la caméra, vitesse, heure de jeu, et le véhicule qu'il conduit. */
export interface TrafficEnv {
  x: number;
  y: number;
  yaw: number;
  speed: number;
  hour: number;
  vehicle: { x: number; y: number } | null;
}

/** Une voiture qui s'éloigne de plus que cela de la couronne de naissance disparaît (si le joueur ne la voit pas). */
const DESPAWN_MARGIN = 70;
/** Délai (s) entre deux naissances, et entre deux retraits de voitures en surnombre. */
const SPAWN_EVERY = 0.25;
const TRIM_EVERY = 0.6;

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private readonly sim: TrafficSim;
  /** Rendu par instances (D65) : un maillage par modèle présent, un pour toutes les roues, un pour les feux. */
  readonly models = new TrafficModels();
  private readonly items: TrafficItem[] = [];
  /** Coût moyen (ms, lissé) d'un pas de simulation de toutes les voitures, pour la ligne de diagnostic. */
  simMs = 0;
  private serial = 0;
  private cooldown = 0;
  private zoneTimer = 0;
  private trimTimer = 0;
  /** Zone du joueur (0 centre ... 3 nature) et nombre de voitures visé à cet instant. */
  zone: number = ZONE.outskirts;
  target = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    terrain: HeightField,
    private readonly colliders: Colliders,
    private readonly solidAt: (x: number, y: number) => boolean,
    private max: number,
    signals: Signals,
    private readonly seed = 1,
  ) {
    this.sim = new TrafficSim(nav.graph, terrain, colliders, signals);
    this.models.prepare(CATALOG.filter((d) => d.family === "car").map((d) => d.id));
    scene.add(this.models.group);
  }

  /** Nuit (0 à 1) : les feux s'allument comme les fenêtres. */
  setNight(glow: number): void {
    this.models.setNight(glow);
  }

  /** Contacts de la circulation au dernier pas (voitures entre elles, avec le joueur). */
  get stats(): TrafficSim["stats"] {
    return this.sim.stats;
  }

  /** Les passants : les voitures les évitent et s'arrêtent pour ceux qui traversent. */
  setPeds(peds: PedLookup | null): void {
    this.sim.peds = peds;
  }

  /** Les voitures telles que les passants les voient (`Observer.vehicles`), à jour de leur position. */
  bodies(): readonly TrafficBody[] {
    this.bodyList.length = 0;
    for (const c of this.cars) {
      const s = c.sim.state, b = c.body;
      b.x = s.x;
      b.y = s.y;
      b.vx = s.vx;
      b.vy = s.vy;
      b.heading = s.heading;
      b.slow = b.speed = b.hits = 0;
      this.bodyList.push(b);
    }
    return this.bodyList;
  }

  /** Après la simulation des passants : une voiture qui a heurté un passant perd 10 à 30 % de sa vitesse (D44, comme le véhicule du joueur). */
  applyImpacts(): void {
    for (const c of this.cars) {
      if (c.body.slow <= 0) continue;
      const keep = 1 - c.body.slow, s = c.sim.state;
      s.vx *= keep;
      s.vy *= keep;
      s.speed *= keep;
    }
  }

  private readonly bodyList: TrafficBody[] = [];
  private pendingHonks: NonNullable<Observer["vehicle"]>[] = [];

  /** Coups de klaxon des conducteurs depuis le dernier appel (à donner aux passants, une seule fois). */
  takeHonks(): readonly NonNullable<Observer["vehicle"]>[] {
    const out = this.pendingHonks;
    this.pendingHonks = [];
    return out;
  }

  /** Le joueur klaxonne : les conducteurs devant lui se pressent (J3-6). */
  playerHorn(x: number, y: number, heading: number): void {
    this.sim.playerHorn(x, y, heading);
  }

  /**
   * Prend la voiture la plus proche de (x, y) à moins de `maxDist` hors de la circulation (J4 : vol) : elle disparaît de la simulation et de l'écran,
   * et ce qu'il faut pour en faire un véhicule de la flotte (`Fleet.add` avec le même modèle et la même couleur) est rendu, avec sa vitesse.
   */
  extract(x: number, y: number, maxDist: number): { model: string; variant: number; x: number; y: number; heading: number; vx: number; vy: number } | null {
    let best = -1, bd = maxDist;
    for (let i = 0; i < this.cars.length; i++) {
      const s = this.cars[i]!.sim.state, d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const c = this.cars[best]!, s = c.sim.state;
    const out = { model: c.def.id, variant: c.variant, x: s.x, y: s.y, heading: s.heading, vx: s.vx, vy: s.vy };
    this.remove(best);
    this.render();
    return out;
  }

  /** Nombre maximal de voitures (le réglage). */
  get capacity(): number {
    return this.max;
  }

  setCapacity(n: number): void {
    this.max = n;
    while (this.cars.length > n) this.remove(this.cars.length - 1);
  }

  /** Un pas de simulation à pas fixe : conducteurs, physique et chocs. `player` : ce que les conducteurs voient du joueur. */
  step(dt: number, player: PlayerBody | null): void {
    if (this.cars.length === 0) return;
    const t0 = performance.now();
    this.sim.step(dt, player);
    for (const h of this.sim.honks) this.pendingHonks.push({ x: h.x, y: h.y, vx: h.vx, vy: h.vy, heading: h.heading, hull: h.hull, hornRange: 35 });
    this.simMs += (performance.now() - t0 - this.simMs) * 0.02;
  }

  /** À chaque image : modèles, retraits (voitures perdues, lointaines ou en surnombre), naissances selon la densité de l'heure et du quartier. */
  update(dt: number, env: TrafficEnv): void {
    const graph = this.nav.graph;
    // Quartier du joueur (zone de la file piétonne la plus proche) : deux fois par seconde suffisent.
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 0.5;
      const hit = graph.nearest(env.x, env.y, 80, MASK_ZONE);
      this.zone = hit ? graph.edgeZone(hit.edge) : ZONE.outskirts;
    }
    this.target = trafficTarget(this.max, env.hour, this.zone, env.speed);
    const { rOut } = spawnRing(env.speed);
    const seen = (x: number, y: number): boolean => visibleFrom(env.x, env.y, env.yaw, 1.1, x, y, this.colliders);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      const d = Math.hypot(c.sim.state.x - env.x, c.sim.state.y - env.y);
      // Perdue (impasse, blocage) ou sortie de la couronne : elle disparaît quand le joueur ne la voit pas. Une voiture perdue qu'il regarde
      // reste (elle ne disparaît pas sous ses yeux), mais pas plus de 20 s.
      const lost = c.sim.driver?.lost ?? false;
      if (lost) c.lostFor += dt;
      // Une voiture collée à une autre retirée par son conducteur disparaît tout de suite (deux voitures qui se chevauchent à l'arrêt choquent plus qu'une disparition).
      const overlapped = c.sim.driver?.lostWhy === "collée à une autre voiture";
      if ((lost || d > rOut + DESPAWN_MARGIN) && (c.lostFor > 20 || overlapped || !seen(c.sim.state.x, c.sim.state.y))) this.remove(i);
    }
    // Surnombre (la nuit tombe, le quartier change) : on retire la plus éloignée que le joueur ne voit pas.
    this.trimTimer -= dt;
    if (this.cars.length > this.target && this.trimTimer <= 0) {
      this.trimTimer = TRIM_EVERY;
      let far = -1, fd = 0;
      for (let i = 0; i < this.cars.length; i++) {
        const s = this.cars[i]!.sim.state, d = Math.hypot(s.x - env.x, s.y - env.y);
        if (d > fd && !seen(s.x, s.y)) {
          fd = d;
          far = i;
        }
      }
      if (far >= 0) this.remove(far);
    }
    this.cooldown -= dt;
    // Au début, on remplit vite (jusqu'à 3 par image tant qu'il manque la moitié) ; ensuite une naissance toutes les 0,25 s.
    let budget = this.cars.length < this.target / 2 ? 3 : 1;
    while (budget-- > 0 && this.cars.length < this.target && (this.cooldown <= 0 || this.cars.length < this.target / 2) && graph.cells.size > 0) {
      this.cooldown = SPAWN_EVERY;
      if (!this.spawn(env)) break;
    }
    this.render();
  }

  /** Écrit les instances à dessiner : une par voiture, à jour de sa position, de son cap, de ses roues. */
  private render(): void {
    const items = this.items;
    items.length = 0;
    for (const c of this.cars) {
      const s = c.sim.state;
      items.push({ model: c.def.id, x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch, lean: s.lean, steer: s.steer, wheel: s.wheel, color: paletteColor(c.def, c.variant) });
    }
    this.models.set(items);
  }

  private remove(i: number): void {
    const c = this.cars[i]!;
    const k = this.sim.cars.indexOf(c.sim);
    if (k >= 0) this.sim.remove(k);
    this.cars.splice(i, 1);
  }

  /** Fait naître une voiture sur une voie libre de la couronne ; faux s'il n'y en a pas (rien n'est alors créé). */
  private spawn(env: TrafficEnv): boolean {
    const rnd = (): number => {
      let h = Math.imul((this.seed + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(++this.serial, 0xc2b2ae35);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
    };
    const cars = CATALOG.filter((d) => d.family === "car");
    const def = cars.find((d) => d.id === pickModel("car", this.zone, rnd())) ?? cars[0]!;
    const taken: { x: number; y: number }[] = this.cars.map((c) => c.sim.state);
    if (env.vehicle) taken.push(env.vehicle);
    else taken.push({ x: env.x, y: env.y });
    const sp = pickSpawn(this.nav.graph, { px: env.x, py: env.y, yaw: env.yaw, speed: env.speed, rnd, taken, solidAt: this.solidAt, colliders: this.colliders, hull: def.spec.hull });
    if (!sp) return false;
    const variant = Math.floor(rnd() * 16);
    // Elle part déjà lancée, à la vitesse du lieu (au plus 9 m/s) : pas de démarrage à l'arrêt au milieu de la rue.
    const sim = this.sim.add(def.spec, sp.move, sp.s, Math.floor(rnd() * 1e9), Math.min((sp.limit * 0.9) / 3.6, 9));
    this.cars.push({ sim, def, variant, body: { x: 0, y: 0, vx: 0, vy: 0, heading: 0, hull: def.spec.hull, slow: 0, speed: 0, hits: 0 }, lostFor: 0 });
    return true;
  }

  dispose(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) this.remove(i);
    this.scene.remove(this.models.group);
    this.models.dispose();
  }
}
