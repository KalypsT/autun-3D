/**
 * Petit train touristique (D117) : logique pure. Une locomotive et trois wagons qui suivent le circuit (`TrainRoute`) : l'abscisse `s` est celle de
 * l'essieu avant de la locomotive ; chaque voiture a ses deux essieux sur le tracé, à la suite. Le train roule à la vitesse permise du tracé
 * (ralenti aux monuments et dans les virages), s'arrête au départ une minute à chaque tour, au feu rouge, et derrière un obstacle.
 *
 * Le temps du jeu va vite (une journée en ≈ 29 min) et un tour prend ≈ 35 min : le train ne peut pas faire un tour entre 11 h et 18 h. Il tourne
 * donc sans fin sur sa boucle, et n'est **montré** qu'aux heures de service : il apparaît à 11 h là où il en est, et disparaît après 18 h, chaque
 * fois loin des yeux du joueur. Analogie : le train d'une maquette qui tourne dans le noir, et qu'on éclaire aux heures d'ouverture.
 */

import type { RoutePoint, TrainRoute } from "./train-route";

/** Une voiture du train : demi-empattement, porte-à-faux (de l'essieu au bout de la caisse), demi-largeur (m). */
export interface TrainCar {
  kind: "loco" | "wagon";
  wheelbase: number;
  overhang: number;
  halfWidth: number;
}

export const LOCO: TrainCar = { kind: "loco", wheelbase: 2.2, overhang: 1.1, halfWidth: 0.95 };
export const WAGON: TrainCar = { kind: "wagon", wheelbase: 3.0, overhang: 1.0, halfWidth: 0.95 };

export const TRAIN = {
  cars: [LOCO, WAGON, WAGON, WAGON] as readonly TrainCar[],
  /** Écart entre deux caisses, attelage compris (m). */
  gap: 0.6,
  /** Arrêt au départ à chaque tour (s). */
  dwell: 60,
  /** Accélération et freinage ordinaires, freinage d'urgence (m/s²). */
  accel: 0.5,
  brake: 1.2,
  emergency: 3,
  /** Distance (m) gardée devant un obstacle, et avant un nœud à feux. */
  keep: 3,
  signalStop: 5,
  /** Heures de service [de, à[ : 11 h - 18 h, tous les jours. */
  hours: [11, 18] as const,
  /** Le joueur est « loin » au-delà de cette distance (m) : le train n'apparaît ni ne disparaît sous ses yeux. */
  far: 150,
} as const;

/** Distance (m) de l'essieu avant de la locomotive au bout arrière du train. */
export function trainLength(cars: readonly TrainCar[] = TRAIN.cars): number {
  let len = cars[0]!.wheelbase + cars[0]!.overhang;
  for (let i = 1; i < cars.length; i++) len += TRAIN.gap + 2 * cars[i]!.overhang + cars[i]!.wheelbase;
  return len;
}

/** Position d'une voiture : centre de la caisse (entre les essieux), cap, et ses deux essieux. */
export interface CarPose {
  x: number;
  y: number;
  heading: number;
  front: RoutePoint;
  rear: RoutePoint;
}

/** Pose de chaque voiture pour une abscisse de l'essieu avant de la locomotive : chaque caisse suit la précédente, ses essieux sur le tracé. */
export function carPoses(route: TrainRoute, s: number, out: CarPose[], cars: readonly TrainCar[] = TRAIN.cars): CarPose[] {
  let front = s;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i]!;
    if (i > 0) front -= TRAIN.gap + cars[i - 1]!.overhang + c.overhang;
    const p = (out[i] ??= { x: 0, y: 0, heading: 0, front: { x: 0, y: 0, heading: 0 }, rear: { x: 0, y: 0, heading: 0 } });
    route.at(front, p.front);
    route.at(front - c.wheelbase, p.rear);
    p.x = (p.front.x + p.rear.x) / 2;
    p.y = (p.front.y + p.rear.y) / 2;
    p.heading = Math.atan2(p.front.x - p.rear.x, p.front.y - p.rear.y);
    front -= c.wheelbase;
  }
  out.length = cars.length;
  return out;
}

/** Le train est-il de service à cette heure ? */
export function trainOnDuty(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= TRAIN.hours[0] && h < TRAIN.hours[1];
}

/**
 * Montré ou non : il apparaît aux heures de service, il disparaît en dehors, chaque fois seulement loin du joueur (au premier appel, il est
 * simplement là s'il est de service).
 */
export function trainShown(shown: boolean | null, hour: number, playerDistance: number): boolean {
  const duty = trainOnDuty(hour);
  if (shown === null) return duty;
  if (shown === duty || playerDistance <= TRAIN.far) return shown;
  return duty;
}

/** Ce que le train voit devant lui à cette image. */
export interface TrainView {
  /** Distance (m) de l'avant de la locomotive au premier obstacle sur sa voie ; Infinity : rien. */
  obstacle: number;
  /** État du prochain feu : vrai s'il faut s'arrêter (rouge, ou orange encore loin) ; null : pas de feu connu (loin du joueur). */
  stopAt: (signalIndex: number) => boolean | null;
}

const FREE: TrainView = { obstacle: Infinity, stopAt: () => null };

export class TrainSim {
  /** Abscisse de l'essieu avant de la locomotive (m), dans la boucle. */
  s: number;
  /** Vitesse (m/s) et temps d'arrêt restant au départ (s). */
  speed = 0;
  dwell: number;
  /** Rotation des roues (rad, pour un rayon de 1 m : le dessin divise par son rayon). */
  wheel = 0;

  constructor(readonly route: TrainRoute, s = 0) {
    this.s = route.wrap(s);
    // Au départ, il attend ; posé ailleurs (essais, captures), il roule.
    this.dwell = this.s === 0 ? TRAIN.dwell : 0;
  }

  /** Avance d'un pas. Sans vue (`FREE`) : le train roule seul, sans obstacle ni feu (loin du joueur). */
  update(dt: number, view: TrainView = FREE): void {
    if (this.dwell > 0) {
      this.dwell -= dt;
      this.speed = 0;
      return;
    }
    const route = this.route;
    // Vitesse visée : la plus petite des limites (tracé, arrivée au départ, feu, obstacle).
    let target = route.speedAt(this.s);
    const toDepot = route.length - this.s;
    target = Math.min(target, stopSpeed(toDepot, TRAIN.brake));
    const sig = this.nextSignal();
    if (sig) {
      const stop = view.stopAt(sig.index);
      if (stop) target = Math.min(target, stopSpeed(sig.distance - TRAIN.signalStop, TRAIN.brake));
    }
    const front = LOCO.overhang;
    if (view.obstacle < Infinity) target = Math.min(target, stopSpeed(view.obstacle - front - TRAIN.keep, TRAIN.brake));
    const urgent = view.obstacle - front - TRAIN.keep < (this.speed * this.speed) / (2 * TRAIN.brake);
    const dv = target - this.speed;
    this.speed = Math.max(0, this.speed + Math.max(-(urgent ? TRAIN.emergency : TRAIN.brake) * dt, Math.min(TRAIN.accel * dt, dv)));
    const ds = Math.min(this.speed * dt, toDepot);
    this.s += ds;
    this.wheel += ds;
    if (this.s >= route.length - 0.05) {
      // Un tour : arrêt au départ.
      this.s = 0;
      this.speed = 0;
      this.dwell = TRAIN.dwell;
    }
  }

  /** Prochain nœud à feux devant l'essieu avant (dans les 60 m), avec sa distance. */
  nextSignal(): { index: number; distance: number } | null {
    const sigs = this.route.signals;
    for (let i = 0; i < sigs.length; i++) {
      const d = sigs[i]!.s - this.s;
      if (d > -1 && d < 60) return { index: i, distance: d };
    }
    return null;
  }
}

/** Vitesse avec laquelle on peut encore s'arrêter sur `distance` m en freinant à `decel` m/s² (0 si la distance est négative). */
function stopSpeed(distance: number, decel: number): number {
  return distance <= 0 ? 0 : Math.sqrt(2 * decel * distance);
}

/** Durée d'un tour sans obstacle ni feu (s), arrêt au départ compris : pour les essais et la doc. */
export function lapTime(route: TrainRoute, dt = 0.1): number {
  const sim = new TrainSim(route);
  sim.dwell = 0;
  let t = 0;
  while (t < 6 * 3600) {
    sim.update(dt);
    t += dt;
    if (sim.dwell > 0) return t + TRAIN.dwell;
  }
  return Infinity;
}

