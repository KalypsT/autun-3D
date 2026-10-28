import type { Colliders } from "./collision";
import type { Driver, Other } from "./driver";
import type { NavGraph } from "./nav-graph";
import type { RoadGraph } from "./road-graph";
import { findRoute } from "./road-route";
import { driveForce, GRAVITY, steerLimit, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";

/**
 * Poursuite (J4, D73) : ce qui fait rouler une voiture de police vers le joueur. Logique pure, au-dessus du conducteur de la circulation (`Driver`).
 * Analogie : le gendarme suit son GPS tant que le fugitif est loin ou caché (mode « route » : itinéraire recalculé toutes les 1,5 s, conducteur en poursuite :
 * axe de la chaussée, plus vite, feux et sens uniques ignorés) ; dès qu'il le voit de près, il lâche le GPS et fonce sur lui (mode « direct ») ;
 * coincé, il recule en braquant pour se dégager ; à côté d'un fugitif arrêté, il s'arrête (les gendarmes descendent, J4-5).
 */

export interface ChaseTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type ChaseMode = "road" | "direct" | "reverse" | "hold";

/** Le joueur vu de moins de cette distance (m), sans mur entre eux : conduite directe. */
export const DIRECT_RANGE = 40;
/** Fugitif immobile (moins de 1 m/s) à moins de cette distance (m) : on s'arrête à côté. */
export const HOLD_DISTANCE = 8;
/** Itinéraire recalculé toutes les … s (ou quand le fugitif change d'arête). */
const REPLAN_EVERY = 1.5;
/** Coincé (à l'arrêt en accélérant) pendant … s : marche arrière pendant … s. */
const STUCK_AFTER = 1.2;
const REVERSE_FOR = 1.4;
/** Plus loin que cela (m) de toute route, la conduite directe s'impose (place, parking, parc). */
const OFF_ROAD = 7;
const A_MAX = 4;
/** Écart visé (m, de centre à centre) derrière un fugitif qui roule : une longueur et demie ; le contact vient quand il freine. */
const FOLLOW_GAP = 7;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Chaser {
  mode: ChaseMode = "road";
  /** Distance au fugitif (m) au dernier pas. */
  distance = Infinity;
  /** Itinéraires calculés (diagnostic) et recherches échouées. */
  plans = 0;
  planFailures = 0;
  /** Marches arrière pour se dégager (diagnostic). */
  reverses = 0;
  private replanIn = 0;
  private goalEdge = -1;
  private stuck = 0;
  private reverseFor = 0;
  private reverseSteer = 1;
  private lastSteer = 0;
  private readonly hit = { x: 0, y: 0 };

  constructor(
    private readonly nav: NavGraph,
    private readonly colliders: Colliders | null,
    private readonly spec: VehicleSpec,
  ) {}

  private get road(): RoadGraph {
    return this.nav.road;
  }

  /** Commandes pour ce pas : la voiture `s`, son conducteur (passé en mode poursuite), les autres usagers, le fugitif. */
  update(s: VehicleState, driver: Driver, dt: number, others: readonly Other[], target: ChaseTarget): DriveInput {
    if (!driver.chase) driver.setChase(true);
    const dx = target.x - s.x, dy = target.y - s.y, d = Math.hypot(dx, dy);
    this.distance = d;
    const u = s.speed;
    // En train de reculer pour se dégager.
    if (this.reverseFor > 0) {
      this.reverseFor -= dt;
      this.mode = "reverse";
      if (this.reverseFor <= 0) this.rejoin(s, driver);
      return { throttle: 0, brake: 1, steer: this.reverseSteer, handbrake: 0 };
    }
    const tspeed = Math.hypot(target.vx, target.vy);
    let input: DriveInput;
    if (tspeed < 1 && d < HOLD_DISTANCE && Math.abs(u) < 1) {
      // Le fugitif est arrêté tout près et nous aussi : on reste là.
      this.mode = "hold";
      this.stuck = 0;
      return { throttle: 0, brake: Math.abs(u) > 0.3 ? 1 : 0, steer: 0, handbrake: Math.abs(u) <= 0.3 ? 1 : 0 };
    }
    const onRoad = this.road.nearest(s.x, s.y, OFF_ROAD);
    const sees = d < DIRECT_RANGE && (this.colliders?.raycast(s.x, s.y, target.x, target.y) ?? null) === null;
    // Un fugitif arrêté à portée : conduite directe, qui ralentit pour s'arrêter à une longueur et demie de lui.
    if (sees || !onRoad || (tspeed < 1 && d < 30)) {
      this.mode = "direct";
      input = this.direct(s, d, target, tspeed);
    } else {
      if (this.mode !== "road") this.rejoin(s, driver);
      this.mode = "road";
      if (driver.lost) this.rejoin(s, driver);
      this.replan(driver, target, dt);
      input = driver.update(s, dt, others);
    }
    this.lastSteer = input.steer;
    // Coincé contre un mur, une voiture : marche arrière en braquant de l'autre côté.
    this.stuck = Math.abs(u) < 0.6 && input.throttle > 0.3 ? this.stuck + dt : Math.max(0, this.stuck - dt);
    if (this.stuck > STUCK_AFTER) {
      this.stuck = 0;
      this.reverseFor = REVERSE_FOR;
      this.reverseSteer = this.lastSteer >= 0 ? -1 : 1;
      this.reverses++;
    }
    return input;
  }

  /** Conduite directe : poursuite d'un point (la position du fugitif un peu en avance sur sa vitesse), à la vitesse du fugitif plus un peu. */
  private direct(s: VehicleState, d: number, t: ChaseTarget, tspeed: number): DriveInput {
    const lead = Math.min(d / 25, 1.2);
    const px = t.x + t.vx * lead, py = t.y + t.vy * lead;
    const alpha = wrap(Math.atan2(px - s.x, py - s.y) - s.heading);
    const u = Math.max(s.speed, 0);
    const L = this.spec.front + this.spec.rear;
    const steer = Math.min(Math.max(Math.atan2(2 * L * Math.sin(alpha), Math.max(d, 1)) / steerLimit(this.spec, u), -1), 1);
    // Vitesse voulue : celle du fugitif, plus de quoi combler l'écart ; au pas si le fugitif est derrière nous.
    let want = Math.min(this.spec.topSpeed * 0.9, tspeed + 0.45 * (d - FOLLOW_GAP));
    // Fugitif arrêté : vitesse qui permet de s'arrêter à `FOLLOW_GAP` en freinant à 5 m/s².
    if (tspeed < 1) want = Math.min(want, Math.sqrt(2 * 5 * Math.max(d - FOLLOW_GAP, 0)));
    if (Math.abs(alpha) > 0.9) want = Math.min(want, 5);
    // Un mur droit devant : on ralentit d'autant.
    const look = 4 + u * 0.9, fx = Math.sin(s.heading), fy = Math.cos(s.heading);
    const wall = this.colliders?.raycast(s.x, s.y, s.x + fx * look, s.y + fy * look) ?? null;
    if (wall !== null) want = Math.min(want, Math.sqrt(2 * 5 * Math.max(wall * look - 2, 0)));
    const a = Math.min(Math.max(1.5 * (want - u), -8), A_MAX);
    const spec = this.spec;
    const resist = spec.drag * u * u + spec.rolling * spec.mass * GRAVITY + (u > 0.3 ? spec.engineBrake : 0);
    let throttle = 0, brake = 0;
    if (a >= 0) throttle = Math.min(Math.max((a * spec.mass + resist) / Math.max(driveForce(spec, u, 1), 1), 0), 1);
    else if (u > 0.3) brake = Math.min(Math.max((-a * spec.mass - resist) / spec.maxBrake, 0), 1);
    return { throttle, brake, steer, handbrake: 0 };
  }

  /** Recalcule l'itinéraire vers l'arête du fugitif (toutes les 1,5 s, ou tout de suite s'il a changé d'arête). */
  private replan(driver: Driver, t: ChaseTarget, dt: number): void {
    this.replanIn -= dt;
    const goal = this.road.nearest(t.x, t.y, 40);
    if (!goal) return;
    if (this.replanIn > 0 && goal.edge === this.goalEdge) return;
    this.replanIn = REPLAN_EVERY;
    this.goalEdge = goal.edge;
    if (!driver.path) return;
    const route = findRoute(this.road, driver.currentMove, goal.edge, goal.x, goal.y, { wrongWay: true, maxExpand: 4000 });
    this.plans++;
    if (!route) {
      this.planFailures++;
      return;
    }
    driver.setPlan(route);
  }

  /** Le conducteur reprend la route la plus proche, dans le sens où la voiture est tournée. */
  private rejoin(s: VehicleState, driver: Driver): void {
    const h = this.road.nearest(s.x, s.y, 30);
    if (!h) return;
    const along = this.road.pointAt(h.edge, h.s, this.hit);
    const forward = Math.cos(wrap(s.heading - along)) >= 0;
    const len = this.road.edgeLength(h.edge);
    driver.restart(h.edge * 2 + (forward ? 0 : 1), forward ? h.s : len - h.s);
    this.replanIn = 0;
    this.goalEdge = -1;
  }
}
