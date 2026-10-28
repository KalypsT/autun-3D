import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { MASK_ZONE, type Observer, type TrafficBody } from "../core/pedestrians";
import type { Signals } from "../core/signals";
import { trafficTarget } from "../core/traffic-density";
import { pickSpawn, spawnRing, visibleFrom } from "../core/traffic-spawn";
import { TrafficSim, type PedLookup, type PlayerBody, type SimCar } from "../core/traffic-sim";
import type { ChaseTarget } from "../core/chase";
import type { PoliceUnit } from "../core/police";
import { CATALOG, paletteColor, vehicleDef, type VehicleDef } from "../core/vehicle-catalog";
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
  /** Voiture de gendarmerie (J4) ; ses gyrophares sont allumés pendant une poursuite (`siren`). */
  police: boolean;
  siren: boolean;
  /** Graine de la recette du conducteur (J4 : celui qui sort quand le joueur prend la voiture). */
  driver: number;
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
/** Le joueur ne voit pas une voiture plus loin que cela (m). */
const SEEN_RANGE = 400;
/** Patrouilles de gendarmerie dans la circulation ordinaire (J4, D72) : une naissance sur `1 / PATROL_SHARE` au plus, une patrouille à la fois. */
const PATROL_SHARE = 0.06;
const MAX_PATROLS = 1;
const POLICE: VehicleDef = vehicleDef("gendarmerie")!;

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
  /** Horloge des gyrophares (s). */
  private beaconClock = 0;
  /**
   * Voitures de police en poursuite voulues (J4, D73) : les patrouilles présentes se mettent en chasse, d'autres naissent hors de vue dans la couronne.
   * Elles comptent dans le plafond : en surnombre, ce sont des civils qui sont retirés.
   */
  pursuers = 0;
  private policeCooldown = 0;

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

  /** La voiture de la circulation la plus proche de (x, y) à moins de `maxDist` (J4 : bouton « Monter »), avec sa vitesse (m/s) ; null sinon. */
  nearest(x: number, y: number, maxDist: number): { def: VehicleDef; distance: number; speed: number } | null {
    let best: TrafficCar | null = null, bd = maxDist;
    for (const c of this.cars) {
      const s = c.sim.state, d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best ? { def: best.def, distance: bd, speed: Math.hypot(best.sim.state.vx, best.sim.state.vy) } : null;
  }

  /**
   * Prend la voiture la plus proche de (x, y) à moins de `maxDist` hors de la circulation (J4 : vol) : elle disparaît de la simulation et de l'écran,
   * et ce qu'il faut pour en faire un véhicule de la flotte (`Fleet.add` avec le même modèle et la même couleur) est rendu, avec sa vitesse.
   */
  extract(x: number, y: number, maxDist: number): { model: string; variant: number; driver: number; x: number; y: number; heading: number; vx: number; vy: number; yawRate: number } | null {
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
    const out = { model: c.def.id, variant: c.variant, driver: c.driver, x: s.x, y: s.y, heading: s.heading, vx: s.vx, vy: s.vy, yawRate: s.yawRate };
    this.remove(best);
    this.render();
    return out;
  }

  /** Voitures de gendarmerie présentes. */
  get policeCount(): number {
    let n = 0;
    for (const c of this.cars) if (c.police) n++;
    return n;
  }

  /** Nombre maximal de voitures (le réglage). */
  get capacity(): number {
    return this.max;
  }

  setCapacity(n: number): void {
    this.max = n;
    while (this.cars.length > n) this.remove(this.cars.length - 1);
  }

  /** Où vont les voitures en poursuite : null, sur le joueur ; sinon ce point (fouille). */
  setChaseTarget(t: ChaseTarget | null): void {
    this.sim.chaseTarget = t;
  }

  /** Les voitures de police (position, cap, en poursuite), réécrites dans `out`. */
  policeUnits(out: PoliceUnit[]): PoliceUnit[] {
    out.length = 0;
    for (const c of this.cars) if (c.police) out.push({ x: c.sim.state.x, y: c.sim.state.y, heading: c.sim.state.heading, chasing: c.sim.chase !== null });
    return out;
  }

  private ram = 0;

  /** Voitures de police : identifiant de simulation, position, cap, vitesse, en poursuite ou non. */
  forEachPolice(visit: (id: number, x: number, y: number, heading: number, speed: number, chasing: boolean) => void): void {
    for (const c of this.cars) if (c.police) visit(c.sim.id, c.sim.state.x, c.sim.state.y, c.sim.state.heading, Math.hypot(c.sim.state.vx, c.sim.state.vy), c.sim.chase !== null);
  }

  /** Position de la voiture de police `id`, ou null si elle n'existe plus. */
  policeCar(id: number): { x: number; y: number } | null {
    for (const c of this.cars) if (c.sim.id === id) return c.sim.state;
    return null;
  }

  /** L'équipage de la voiture `id` est descendu (elle reste garée) ou remonté. */
  park(id: number, on: boolean): void {
    for (const c of this.cars) if (c.sim.id === id && c.sim.chase) c.sim.chase.parked = on;
  }

  /** Pire choc (m/s) entre le véhicule du joueur et une voiture de police depuis le dernier appel. */
  takeRam(): number {
    const r = this.ram;
    this.ram = 0;
    return r;
  }

  /** Un pas de simulation à pas fixe : conducteurs, physique et chocs. `player` : ce que les conducteurs voient du joueur. */
  step(dt: number, player: PlayerBody | null): void {
    if (this.cars.length === 0) return;
    const t0 = performance.now();
    this.sim.step(dt, player);
    for (const c of this.cars) if (c.police && c.sim.hitPlayer > this.ram) this.ram = c.sim.hitPlayer;
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
    this.beaconClock += dt;
    const { rOut } = spawnRing(env.speed);
    // Au-delà de 400 m on ne voit plus une voiture (les murs lointains ne sont pas chargés : sans cette borne, une voiture droit devant à 1 km passait pour vue
    // et ne disparaissait jamais ; trouvé par l'endurance de la poursuite, D76).
    const seen = (x: number, y: number): boolean => Math.hypot(x - env.x, y - env.y) < SEEN_RANGE && visibleFrom(env.x, env.y, env.yaw, 1.1, x, y, this.colliders);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      const d = Math.hypot(c.sim.state.x - env.x, c.sim.state.y - env.y);
      // Perdue (impasse, blocage) ou sortie de la couronne : elle disparaît quand le joueur ne la voit pas. Une voiture perdue qu'il regarde
      // reste (elle ne disparaît pas sous ses yeux), mais pas plus de 20 s.
      // En poursuite, un conducteur « perdu » est remis sur la route par la poursuite ; une voiture de police ne disparaît que très loin, hors de vue.
      if (c.sim.chase) {
        if (d > rOut + DESPAWN_MARGIN + 150 && !seen(c.sim.state.x, c.sim.state.y)) this.remove(i);
        continue;
      }
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
        if (this.cars[i]!.sim.chase) continue;
        const s = this.cars[i]!.sim.state, d = Math.hypot(s.x - env.x, s.y - env.y);
        if (d > fd && !seen(s.x, s.y)) {
          fd = d;
          far = i;
        }
      }
      if (far >= 0) this.remove(far);
    }
    this.updatePursuit(dt, env);
    this.cooldown -= dt;
    // Au début, on remplit vite (jusqu'à 3 par image tant qu'il manque la moitié) ; ensuite une naissance toutes les 0,25 s.
    let budget = this.cars.length < this.target / 2 ? 3 : 1;
    while (budget-- > 0 && this.cars.length < this.target && (this.cooldown <= 0 || this.cars.length < this.target / 2) && graph.cells.size > 0) {
      this.cooldown = SPAWN_EVERY;
      if (!this.spawn(env)) break;
    }
    this.render();
  }

  /** Voitures en poursuite. */
  get chasing(): number {
    let n = 0;
    for (const c of this.cars) if (c.sim.chase) n++;
    return n;
  }

  /** Met en chasse ou rappelle des voitures de police pour atteindre `pursuers` ; fait naître celles qui manquent (une toutes les 2 s, hors de vue). */
  private updatePursuit(dt: number, env: TrafficEnv): void {
    let n = this.chasing;
    for (const c of this.cars) {
      if (n <= this.pursuers) break;
      if (!c.sim.chase) continue;
      this.sim.setChase(c.sim, false);
      c.siren = false;
      n--;
    }
    for (const c of this.cars) {
      if (n >= this.pursuers) break;
      if (!c.police || c.sim.chase) continue;
      this.sim.setChase(c.sim, true);
      c.siren = true;
      n++;
    }
    this.policeCooldown -= dt;
    if (n < this.pursuers && this.policeCooldown <= 0 && this.nav.graph.cells.size > 0) {
      this.policeCooldown = 2;
      // La piste perdue (la poursuite vise un point de fouille), les renforts naissent autour de ce point, pas autour du joueur que la police ne sait pas où trouver.
      const at = this.sim.chaseTarget;
      const c = this.spawn(env, true, at ? { x: at.x, y: at.y } : undefined);
      if (c) {
        this.sim.setChase(c.sim, true);
        c.siren = true;
      }
    }
  }

  /** Écrit les instances à dessiner : une par voiture, à jour de sa position, de son cap, de ses roues. */
  private render(): void {
    const items = this.items;
    items.length = 0;
    for (const c of this.cars) {
      const s = c.sim.state;
      const item: TrafficItem = { model: c.def.id, x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch, lean: s.lean, steer: s.steer, wheel: s.wheel, color: paletteColor(c.def, c.variant) };
      if (c.siren) item.beacon = this.beaconClock;
      items.push(item);
    }
    this.models.set(items);
  }

  private remove(i: number): void {
    const c = this.cars[i]!;
    const k = this.sim.cars.indexOf(c.sim);
    if (k >= 0) this.sim.remove(k);
    this.cars.splice(i, 1);
  }

  /** Fait naître une voiture (de police si `police`) sur une voie libre de la couronne ; null s'il n'y en a pas (rien n'est alors créé). */
  private spawn(env: TrafficEnv, police = false, around?: { x: number; y: number }): TrafficCar | null {
    const rnd = (): number => {
      let h = Math.imul((this.seed + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(++this.serial, 0xc2b2ae35);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
    };
    const cars = CATALOG.filter((d) => d.family === "car");
    let def = cars.find((d) => d.id === pickModel("car", this.zone, rnd())) ?? cars[0]!;
    if ((rnd() < PATROL_SHARE && this.policeCount < MAX_PATROLS) || police) def = POLICE;
    const taken: { x: number; y: number }[] = this.cars.map((c) => c.sim.state);
    if (env.vehicle) taken.push(env.vehicle);
    else taken.push({ x: env.x, y: env.y });
    const sp = pickSpawn(this.nav.graph, { px: env.x, py: env.y, yaw: env.yaw, speed: env.speed, rnd, taken, solidAt: this.solidAt, colliders: this.colliders, hull: def.spec.hull, ...(around ? { around } : {}) });
    if (!sp) return null;
    const variant = Math.floor(rnd() * 16);
    const driver = Math.floor(rnd() * 4294967296);
    // Elle part déjà lancée, à la vitesse du lieu (au plus 9 m/s) : pas de démarrage à l'arrêt au milieu de la rue.
    const sim = this.sim.add(def.spec, sp.move, sp.s, Math.floor(rnd() * 1e9), Math.min((sp.limit * 0.9) / 3.6, 9));
    const car: TrafficCar = { sim, def, variant, driver, police: def === POLICE, siren: false, body: { x: 0, y: 0, vx: 0, vy: 0, heading: 0, hull: def.spec.hull, slow: 0, speed: 0, hits: 0 }, lostFor: 0 };
    this.cars.push(car);
    return car;
  }

  dispose(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) this.remove(i);
    this.scene.remove(this.models.group);
    this.models.dispose();
  }
}
