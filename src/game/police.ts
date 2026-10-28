import type { ChaseTarget } from "../core/chase";
import type { Colliders } from "../core/collision";
import { RoadWatch } from "../core/offenses";
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
  /** Passants renversés par le véhicule du joueur à cette image (`PedSim.impact`) : nombre et vitesse du choc. */
  pedHits: number;
  pedHitSpeed: number;
  /** Passants à moins de `r` de (x, y) (témoins possibles). */
  witnesses(x: number, y: number, r: number): number;
}

/** La vue de la police est recalculée … fois par seconde. */
const SIGHT_HZ = 10;
/** Un passant tombe au-dessus de cette vitesse de choc (D44) : c'est « renverser ». */
const KNOCK_SPEED = 3.5;

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
    if (traffic && traffic.takeRam() > RAM_IMPACT) w.report("ram_police", p.x, p.y, "police");
    if (this.evade.update(dt, w.stars, this.seen, p.x, p.y, p.speed, this.units)) w.report("evade", p.x, p.y, "police");
    w.update(dt, p.x, p.y, this.seen);
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
