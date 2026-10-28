import type { ChaseTarget } from "../core/chase";
import type { Colliders } from "../core/collision";
import { RoadWatch } from "../core/offenses";
import { OFFICER, Officers, shotHitChance, type OfficerShot } from "../core/officers";
import type { VehicleSpec, VehicleState } from "../core/vehicle";
import { EvadeWatch, policeSees, PURSUERS, Search, type PoliceUnit } from "../core/police";
import type { RoadGraph } from "../core/road-graph";
import type { Signals } from "../core/signals";
import { RAM_IMPACT, type Crime, type Wanted } from "../core/wanted";
import type { Traffic } from "./traffic";

/** Ce que la police doit savoir du joueur à chaque image. */
export interface PolicePlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Cap du véhicule conduit ou du joueur (rad, 0 = nord). */
  heading: number;
  speed: number;
  driving: boolean;
  /** Le véhicule conduit (les gendarmes à pied l'évitent, il les renverse) ; null à pied. */
  vehicle: { state: VehicleState; spec: VehicleSpec } | null;
  /** Passants renversés par le véhicule du joueur à cette image (`PedSim.impact`) : nombre et vitesse du choc. */
  pedHits: number;
  pedHitSpeed: number;
  /** Passants tués par le véhicule du joueur à cette image (J5-4). */
  pedKills?: number;
  /** Passants à moins de `r` de (x, y) (témoins possibles). */
  witnesses(x: number, y: number, r: number): number;
}

/**
 * Reprise après une arrestation (D75) : à pied, sur le trottoir d'une route du bord est de l'anneau, à mi-hauteur (la gendarmerie d'Autun est à ≈ 270 m
 * à l'est de la zone, D33 ; sa position exacte n'est pas dans les données). Vérifié par un test : un trottoir, dans la zone jouable.
 */
export const ARREST_SPAWN = { x: 1407.8, y: -250.1, heading: -Math.PI / 2 } as const;
/** Heures passées en cellule. */
export const ARREST_HOURS = 6;

/** La vue de la police est recalculée … fois par seconde. */
const SIGHT_HZ = 10;
/** Un passant tombe au-dessus de cette vitesse de choc (D44) : c'est « renverser ». */
const KNOCK_SPEED = 3.5;
/** L'équipage descend d'une voiture en poursuite arrêtée (moins de 0,6 m/s) à moins de … m d'un joueur à pied ou au pas (moins de 3 m/s) qu'elle voit. */
const DEPLOY_REACH = 28;
/** Les gendarmes remontent quand le joueur roule à plus de … m/s et qu'ils sont à plus de … m de lui. */
const RECALL_SPEED = 6;
const RECALL_GAP = 12;

/**
 * La police dans le jeu (J4, D74) : elle regarde (ses voitures voient le joueur ou non), constate les infractions (vol, passant renversé,
 * voiture de police percutée, excès de vitesse et feu rouge sous ses yeux, refus de s'arrêter), règle le niveau de recherche, envoie des voitures
 * selon les étoiles et les dirige sur le joueur ou, quand elle l'a perdu, sur la zone de recherche.
 */
export class PoliceController {
  private readonly watch: RoadWatch;
  private readonly search = new Search(17);
  private readonly evade = new EvadeWatch();
  readonly units: PoliceUnit[] = [];
  private sightTimer = 0;
  private seen = false;
  private readonly target: ChaseTarget = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Poursuivants imposés en plus des étoiles (`?chase=N`, essais). */
  minPursuers = 0;
  /** Gendarmes à pied (J4-5). */
  readonly officers: Officers;
  /** Le joueur vient d'être arrêté : le jeu le constate (`takeArrest`) et applique la peine. */
  private arrested = false;
  private readonly parked = new Set<number>();
  private readonly cars: { id: number; x: number; y: number; heading: number; speed: number; chasing: boolean }[] = [];
  private seq = 0;
  /** Tirs de la police à cette image (le jeu les dessine puis appelle `clearShots`), points de vie retirés au joueur depuis `takeDamage`, armes lâchées depuis `takeDrops`. */
  readonly shots: OfficerShot[] = [];
  private damage = 0;
  private readonly drops: { x: number; y: number }[] = [];
  private readonly carCool = new Map<number, number>();
  /** Ce que la minimap montre : voitures de police et zone de recherche quand la piste est perdue. */
  readonly minimap: { units: { x: number; y: number }[]; search: { x: number; y: number; r: number } | null } = { units: [], search: null };

  constructor(
    readonly wanted: Wanted,
    private readonly colliders: Colliders,
    private readonly road: () => RoadGraph | null,
    signals: () => Signals | null,
    /** La circulation, créée au besoin (la police en a besoin même avec « Circulation : Aucune »). */
    private readonly traffic: (create: boolean) => Traffic | null,
  ) {
    this.watch = new RoadWatch(road, signals);
    this.officers = new Officers(colliders);
  }

  /** Police armée (J5-5) : points de vie retirés au joueur par les tirs depuis le dernier appel (le jeu applique la moitié au volant). */
  takeDamage(): number {
    const d = this.damage;
    this.damage = 0;
    return d;
  }

  clearShots(): void {
    this.shots.length = 0;
  }

  /** Positions des gendarmes tués depuis le dernier appel : leur pistolet tombe là. */
  takeDrops(out: { x: number; y: number }[]): void {
    for (const d of this.drops) out.push(d);
    this.drops.length = 0;
  }

  /** Vrai une fois après une arrestation. */
  takeArrest(): boolean {
    const a = this.arrested;
    this.arrested = false;
    return a;
  }

  /** Après l'arrestation : plus de gendarmes à pied, voitures libérées, plus d'étoile. */
  reset(): void {
    this.officers.clear();
    this.shots.length = 0;
    this.damage = 0;
    this.drops.length = 0;
    this.carCool.clear();
    const t = this.traffic(false);
    for (const id of this.parked) t?.park(id, false);
    this.parked.clear();
    this.wanted.clear();
  }

  /** Équipages : descente près du joueur, rappel quand il s'en va en roulant, voitures libérées quand tous sont remontés. */
  private crews(dt: number, p: PolicePlayer, traffic: Traffic): void {
    const w = this.wanted, off = this.officers;
    const cars = this.cars;
    cars.length = 0;
    traffic.forEachPolice((id, x, y, heading, speed, chasing) => cars.push({ id, x, y, heading, speed, chasing }));
    if (w.stars > 0 && (!p.driving || p.speed < 3)) {
      for (const c of cars) {
        if (!c.chasing || c.speed > 0.6 || off.countOf(c.id) > 0 || Math.hypot(c.x - p.x, c.y - p.y) > DEPLOY_REACH) continue;
        if ((this.colliders.raycast(c.x, c.y, p.x, p.y) ?? null) !== null) continue;
        // Portière gauche, et la droite pour le second à deux étoiles et plus.
        for (let k = 0; k < (w.stars >= 2 ? 2 : 1); k++) {
          const side = k === 0 ? -1 : 1;
          const x = c.x + Math.cos(c.heading) * 1.3 * side, y = c.y - Math.sin(c.heading) * 1.3 * side;
          off.spawn(x, y, c.heading, c.id, (c.id * 7919 + ++this.seq * 104729) >>> 0);
        }
        if (off.countOf(c.id) > 0) {
          traffic.park(c.id, true);
          this.parked.add(c.id);
        }
      }
    }
    if (w.stars === 0) off.recall(-1);
    else if (p.driving && p.speed > RECALL_SPEED) {
      for (const o of off.list) if (Math.hypot(o.x - p.x, o.y - p.y) > RECALL_GAP) off.recall(o.car);
    }
    // Armés à quatre étoiles et plus (D85) ; au volant, seulement à cinq (à quatre ils cherchent encore à arrêter la voiture).
    const armed = w.stars >= 4 && (!p.driving || w.stars >= 5);
    off.step(dt, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, vehicle: p.vehicle }, (id) => traffic.policeCar(id), armed);
    this.damage += off.takeDamage();
    for (const sh of off.shots) if (this.shots.length < 48) this.shots.push(sh);
    off.clearShots();
    if (off.takeDeaths(this.drops) > 0) w.report("kill_cop", p.x, p.y, "police");
    if (w.stars >= 5) this.carFire(dt, p);
    for (const id of this.parked) {
      if (off.countOf(id) > 0) continue;
      traffic.park(id, false);
      this.parked.delete(id);
    }
    if (off.takeHits() > 0) w.report("hit_cop", p.x, p.y, "police");
    if (off.arrested) {
      this.arrested = true;
      off.arrested = false;
      off.progress = 0;
    }
  }

  /**
   * Cinq étoiles : le passager d'une voiture de poursuite à moins de 35 m, avec le joueur dans sa vue (sans mur), tire par la vitre toutes les 1,5 s environ ;
   * moins précis qu'à pied (la voiture bouge), même dégât par balle.
   */
  private carFire(dt: number, p: PolicePlayer): void {
    const live = new Set<number>();
    for (const c of this.cars) {
      if (!c.chasing) continue;
      live.add(c.id);
      // Un équipage descendu ne tire plus de la voiture.
      if (this.officers.countOf(c.id) > 0) continue;
      const cd = (this.carCool.get(c.id) ?? 1.2) - dt;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (cd > 0 || d > 35 || (this.colliders.raycast(c.x, c.y, p.x, p.y) ?? null) !== null) {
        this.carCool.set(c.id, Math.max(cd, 0));
        continue;
      }
      this.carCool.set(c.id, 1.5 + 0.5 * ((c.id * 2654435761) % 1000) / 1000);
      // Tirage reproductible par voiture et par instant : pas de hasard global.
      const roll = (((c.id * 7919 + this.seq++ * 104729) * 2654435761) >>> 0) / 4294967296;
      const hit = roll < shotHitChance(d, p.speed, true);
      if (hit) this.damage += OFFICER.damage;
      if (this.shots.length < 48) {
        const ux = (p.x - c.x) / (d || 1), uy = (p.y - c.y) / (d || 1), off = hit ? 0 : 1.2;
        this.shots.push({ x0: c.x + ux, y0: c.y + uy, x1: p.x - uy * off + (hit ? 0 : ux * 3), y1: p.y + ux * off + (hit ? 0 : uy * 3), hit });
      }
    }
    for (const id of this.carCool.keys()) if (!live.has(id)) this.carCool.delete(id);
  }

  /** La police voit-elle ce point en ce moment ? */
  sees(x: number, y: number): boolean {
    const t = this.traffic(false);
    if (!t) return false;
    return policeSees(t.policeUnits(this.units), x, y, this.colliders);
  }

  /** Une infraction ponctuelle en (x, y) : comptée tout de suite si la police la voit, sinon signalée par un passant si `civilians` (et si l'infraction s'y prête). */
  crime(kind: Crime, x: number, y: number, civilians: boolean): void {
    if (this.sees(x, y)) this.wanted.report(kind, x, y, "police");
    else if (civilians) this.wanted.report(kind, x, y, "civilian");
  }

  update(dt: number, p: PolicePlayer): void {
    const w = this.wanted;
    const traffic = this.traffic(w.stars > 0 || this.minPursuers > 0);
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 1 / SIGHT_HZ;
      if (traffic) traffic.policeUnits(this.units);
      else this.units.length = 0;
      // Les gendarmes à pied voient aussi (tout autour d'eux, comme en poursuite).
      for (const o of this.officers.list) if (o.mode === "run" || o.mode === "back") this.units.push({ x: o.x, y: o.y, heading: o.heading, chasing: true });
      this.seen = policeSees(this.units, p.x, p.y, this.colliders);
    }
    // Infractions de conduite : seulement sous les yeux de la police.
    if (p.driving) {
      const red = this.watch.update(p.x, p.y, p.heading, p.speed, dt);
      if (this.seen && red) w.report("red_light", p.x, p.y, "police");
      if (this.seen && this.watch.speeding) w.report("speeding", p.x, p.y, "police");
    }
    // Passant renversé : la police s'il la voit, sinon un autre passant à moins de 40 m appelle.
    if (p.pedHits > 0 && p.pedHitSpeed >= KNOCK_SPEED) {
      if (this.seen) w.report("hit_ped", p.x, p.y, "police");
      else if (p.witnesses(p.x, p.y, 40) >= 2) w.report("hit_ped", p.x, p.y, "civilian");
    }
    // Passant tué par le véhicule : un meurtre (en plus de l'infraction de l'avoir renversé).
    if (p.pedKills) {
      if (this.seen) w.report("murder", p.x, p.y, "police");
      else if (p.witnesses(p.x, p.y, 40) >= 1) w.report("murder", p.x, p.y, "civilian");
    }
    if (traffic && traffic.takeRam() > RAM_IMPACT) w.report("ram_police", p.x, p.y, "police");
    if (this.evade.update(dt, w.stars, this.seen, p.x, p.y, p.speed, this.units)) w.report("evade", p.x, p.y, "police");
    w.update(dt, p.x, p.y, this.seen);
    if (traffic) this.crews(dt, p, traffic);
    else this.officers.clear();
    // Renforts selon les étoiles ; la fouille quand la piste est perdue.
    if (traffic) {
      traffic.pursuers = Math.max(PURSUERS[w.stars] ?? 0, this.minPursuers);
      this.search.update(dt, w, p.x, p.y, this.units, this.road());
      if (w.stars === 0 || w.seen) traffic.setChaseTarget(null);
      else {
        this.target.x = this.search.x;
        this.target.y = this.search.y;
        traffic.setChaseTarget(this.target);
      }
    }
    const m = this.minimap;
    m.units.length = 0;
    for (const u of this.units) m.units.push(u);
    m.search = w.stars > 0 && !w.seen ? { x: w.lastX, y: w.lastY, r: w.radius } : null;
  }
}
