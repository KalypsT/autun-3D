import { gendarmeRecipe } from "../character";
import { LIFE_POSE } from "../character-rig";
import { lanePoint } from "../driver";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { EventRng, type EventAction, type EventCarView, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Accident entre deux voitures (E4, lot 3 de la phase 4) : la scène est posée **hors de vue, sur le chemin du joueur** : deux voitures de la
 * circulation de travers, cabossées, feux de détresse ; leurs conducteurs sont descendus et **se disputent** (bulles, gestes), quelques curieux
 * regardent, la circulation bouchonne derrière (klaxons). Au bout d'une minute environ, une **patrouille** arrive, se gare gyrophares allumés ;
 * un gendarme descend faire le **constat** ; puis chacun remonte. Le joueur peut regarder, contourner, voler une des voitures (personne au volant :
 * un vol de véhicule, vu par la police seulement), ou s'en prendre à un conducteur (une agression comme une autre). Pas de prime : c'est du décor.
 */

export const ACCIDENT = {
  /** À cette distance du joueur (m) : au volant, à pied. */
  driveNear: 80,
  driveFar: 200,
  footNear: 40,
  footFar: 120,
  /** Routes : classes 0 (principale) à 4 (résidentielle), au moins … m de large, à … m au moins d'un bout d'arête (pas au milieu d'un carrefour). */
  maxClass: 4,
  minWidth: 5,
  endClear: 9,
  /** Aucune autre voiture à moins de … m. */
  clear: 14,
  /** La patrouille part après … – … s ; elle se gare à moins de … m ; constat de … s ; départ. */
  policeAfter: [45, 75] as const,
  parkReach: 14,
  constat: 22,
  /** Un klaxon du bouchon toutes les … – … s (s'il y a une voiture derrière). */
  honk: [4, 9] as const,
  /** Une réplique toutes les … s. */
  line: 2.6,
  /** Curieux : jusqu'à … passants à moins de … m. */
  onlookers: 3,
  onlookerRange: 35,
  /** Le joueur est parti : au-delà de … m pendant … s, tout s'arrête. */
  leaveFar: 250,
  leaveFor: 20,
  /** Durée maximale de la scène (s). */
  maxLife: 240,
} as const;

const LINES_A = ["Vous m'avez coupé la route !", "Vous rouliez trop vite !", "Regardez ma voiture !", "On fait un constat ?", "Vous étiez au téléphone !"] as const;
const LINES_B = ["C'est vous qui avez freiné !", "Pas de clignotant !", "Je ne suis pas d'accord !", "Il y a des témoins !", "Appelez la gendarmerie !"] as const;

export interface AccidentSite {
  x: number;
  y: number;
  heading: number;
  variant: 0 | 1;
}

const tmp = { x: 0, y: 0 };
const lp = { x: 0, y: 0, heading: 0 };

/**
 * Cherche le lieu d'un accident : devant le joueur (dans le sens de sa marche, ou de son regard s'il est arrêté), à 80 – 200 m au volant,
 * 40 – 120 m à pied, sur une route assez large, loin des bouts d'arête, hors de vue et sans voiture autour.
 */
export function findAccidentSite(road: RoadGraph, traffic: EventTraffic, ctx: EventContext, rng: EventRng): AccidentSite | null {
  const p = ctx.player;
  const dir = p.speed > 2 ? Math.atan2(p.vx, p.vy) : p.yaw;
  const [near, far] = p.onFoot ? [ACCIDENT.footNear, ACCIDENT.footFar] : [ACCIDENT.driveNear, ACCIDENT.driveFar];
  for (let k = 0; k < 14; k++) {
    const a = dir + (rng.next() - 0.5) * (k < 8 ? 0.9 : 2.4), r = near + rng.next() * (far - near);
    const hit = road.nearest(p.x + Math.sin(a) * r, p.y + Math.cos(a) * r, 25);
    if (!hit) continue;
    const e = hit.edge, len = road.edgeLength(e);
    if (!road.drivable(e) || road.edgeClass(e) > ACCIDENT.maxClass || road.edgeWidth(e) < ACCIDENT.minWidth) continue;
    if (hit.s < ACCIDENT.endClear || hit.s > len - ACCIDENT.endClear) continue;
    // Le sens de la voie : celui qui est permis (sens unique), sinon au hasard.
    const ow = road.oneway(e);
    const move = ow === 1 ? e * 2 : ow === 2 ? e * 2 + 1 : e * 2 + (rng.next() < 0.5 ? 0 : 1);
    lanePoint(road, move, move & 1 ? len - hit.s : hit.s, lp);
    if (Math.hypot(lp.x - p.x, lp.y - p.y) < near * 0.8) continue;
    if (ctx.visible(lp.x, lp.y) || traffic.carsNear(lp.x, lp.y, ACCIDENT.clear) > 0) continue;
    return { x: lp.x, y: lp.y, heading: lp.heading, variant: rng.next() < 0.6 ? 0 : 1 };
  }
  return null;
}

type Phase = "dispute" | "police" | "constat" | "depart" | "over";

export class AccidentEvent implements GameEvent {
  readonly kind = "accident" as const;
  readonly big = true;
  x: number;
  y: number;
  done = false;
  outcome: EventOutcome | null = null;
  readonly goodDeed = false;
  phase: Phase = "dispute";
  /** Les deux voitures (identifiants de la circulation), la patrouille (−1 : pas encore). */
  readonly cars: [number, number];
  police = -1;
  /** Conducteurs (emplacements de la foule ; −1 s'ils n'ont pas pu descendre), gendarme, curieux. */
  readonly drivers: [number, number] = [-1, -1];
  gendarme = -1;
  readonly onlookers: number[] = [];
  private t = 0;
  private phaseT = 0;
  private lineT = 0;
  private speaker = 0;
  private honkT = 3;
  private awayT = 0;
  private readonly policeAt: number;
  private readonly target: { x: number; y: number; vx: number; vy: number };
  private readonly heading: number;
  private gathered = false;

  /** Pose la scène ; `ok` faux si une des voitures n'a pas pu être posée (rien n'est alors laissé). */
  readonly ok: boolean;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly fx: EventEffects & { honk(x: number, y: number): void },
    site: AccidentSite,
    private readonly rng: EventRng,
  ) {
    this.x = site.x;
    this.y = site.y;
    this.heading = site.heading;
    // La patrouille se gare derrière la scène, sur la voie (elle viserait sinon le milieu des voitures accidentées).
    this.target = { x: site.x - Math.sin(site.heading) * 12, y: site.y - Math.cos(site.heading) * 12, vx: 0, vy: 0 };
    this.policeAt = ACCIDENT.policeAfter[0] + rng.next() * (ACCIDENT.policeAfter[1] - ACCIDENT.policeAfter[0]);
    const h = site.heading, ux = Math.sin(h), uy = Math.cos(h), rx = uy, ry = -ux;
    const seed = Math.floor(rng.next() * 1e9);
    // Variante 0 : choc par l'arrière (la seconde a percuté la première qui freinait) ; 1 : accrochage de côté.
    const a = traffic.stage(site.x, site.y, h + (rng.next() - 0.5) * 0.3, seed);
    const b = site.variant === 0
      ? traffic.stage(site.x - ux * 5 - rx * 0.6, site.y - uy * 5 - ry * 0.6, h - 0.35, seed ^ 0x5bd1)
      : traffic.stage(site.x - ux * 1.2 - rx * 1.9, site.y - uy * 1.2 - ry * 1.9, h + 0.55, seed ^ 0x5bd1);
    if (!a || !b) {
      if (a) traffic.drop(a.id);
      if (b) traffic.drop(b.id);
      this.cars = [-1, -1];
      this.ok = false;
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    this.ok = true;
    this.cars = [a.id, b.id];
    // Les dégâts, là où les voitures se sont touchées.
    // Assez pour cabosser la carrosserie et faire fumer un peu (palier « fumée », D112), pas assez pour un feu.
    traffic.dent(a.id, 42, b.state.x, b.state.y);
    traffic.dent(b.id, 46, a.state.x, a.state.y);
    for (const c of [a, b]) {
      traffic.setHazard(c.id, true);
      traffic.setNoDriver(c.id, true);
    }
    // Les conducteurs, descendus côté gauche, se font face entre les deux voitures (côté trottoir).
    const mx = (a.state.x + b.state.x) / 2 + rx * 2.4, my = (a.state.y + b.state.y) / 2 + ry * 2.4;
    this.drivers[0] = peds.appear(mx + ux * 0.8, my + uy * 0.8, a.driver, h + Math.PI);
    this.drivers[1] = peds.appear(mx - ux * 0.8, my - uy * 0.8, b.driver, h);
  }

  private carOf(k: 0 | 1): EventCarView | null {
    return this.traffic.eventCar(this.cars[k]);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.phaseT += dt;
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > ACCIDENT.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > ACCIDENT.leaveFor || this.t > ACCIDENT.maxLife) return this.finish(this.outcome ?? "termine");
    // Une des voitures a disparu (le joueur l'a prise) : son conducteur crie, la dispute s'arrête.
    for (const k of [0, 1] as const) {
      if (this.cars[k] >= 0 && !this.carOf(k)) {
        this.cars[k] = -1;
        const d = this.drivers[k];
        if (this.here(d)) {
          this.fx.say(d, "Ma voiture !", 3);
          this.peds.command(d, ORDER.hold, p.x, p.y, 0, LIFE_POSE.point);
        }
        this.outcome = "vole";
      }
    }
    // Un conducteur bousculé, frappé : la dispute tourne court, chacun s'en va.
    if (this.drivers.some((d) => d >= 0 && this.peds.modeOf(d) >= PED_STATE.stumble)) {
      for (const d of this.drivers) if (this.here(d)) this.peds.release(d);
      this.drivers[0] = this.drivers[1] = -1;
      this.outcome ??= "enfui";
    }
    if (!this.gathered && Math.hypot(this.x - p.x, this.y - p.y) < 160) this.gather();
    this.honkStep(dt);
    switch (this.phase) {
      case "dispute":
        this.dispute(dt);
        if (this.phaseT > this.policeAt) this.callPolice();
        return;
      case "police":
        this.dispute(dt);
        return this.policeStep();
      case "constat":
        return this.constatStep(dt);
      case "depart":
        return this.departStep();
    }
  }

  /** Les deux conducteurs se disputent : l'un parle (bras tendu), l'autre écoute en gesticulant ; une réplique toutes les 2,6 s. */
  private dispute(dt: number): void {
    const [a, b] = this.drivers;
    this.lineT -= dt;
    if (this.lineT <= 0) {
      this.lineT = ACCIDENT.line;
      this.speaker = 1 - this.speaker;
      const who = this.drivers[this.speaker]!;
      if (this.here(who) && this.outcome !== "vole") {
        const lines = this.speaker === 0 ? LINES_A : LINES_B;
        this.fx.say(who, lines[Math.floor(this.rng.next() * lines.length)]!, 2.3);
      }
    }
    for (const k of [0, 1] as const) {
      const me = this.drivers[k], other = k === 0 ? b : a;
      if (!this.here(me) || this.outcome === "vole") continue;
      this.peds.position(other >= 0 && this.here(other) ? other : me, tmp);
      const pose = this.speaker === k ? LIFE_POSE.point : LIFE_POSE.talk;
      this.peds.command(me, ORDER.hold, tmp.x, tmp.y, 0, pose);
    }
  }

  /** Les curieux : quelques passants proches viennent regarder, de part et d'autre de la scène, côté trottoir. */
  private gather(): void {
    this.gathered = true;
    const near: number[] = [];
    this.peds.queryCircle(this.x, this.y, ACCIDENT.onlookerRange, near);
    const h = this.heading, rx = Math.cos(h), ry = -Math.sin(h), fx = Math.sin(h), fy = Math.cos(h);
    for (const i of near) {
      if (this.onlookers.length >= ACCIDENT.onlookers) break;
      if (this.drivers.includes(i) || this.peds.modeOf(i) !== PED_STATE.walk || this.peds.isBorrowed(i) || this.peds.attached(i)) continue;
      if (!this.peds.borrow(i)) continue;
      this.onlookers.push(i);
    }
    this.onlookers.forEach((i, k) => {
      const along = (k - 1) * 3.2;
      const gx = this.x + rx * 5.5 + fx * along, gy = this.y + ry * 5.5 + fy * along;
      this.peds.command(i, ORDER.seek, gx, gy, 1.3);
    });
  }

  /** Les curieux arrivés regardent la scène (certains au téléphone : ils filment). */
  private watch(): void {
    this.onlookers.forEach((i, k) => {
      if (!this.here(i) || this.peds.speedOf(i) > 0.2) return;
      this.peds.command(i, ORDER.hold, this.x, this.y, 0, k === 1 ? LIFE_POSE.phone : 0);
    });
  }

  /** Klaxons du bouchon : de temps en temps, une voiture arrêtée derrière la scène klaxonne. */
  private honkStep(dt: number): void {
    this.watch();
    if (this.phase === "depart") return;
    this.honkT -= dt;
    if (this.honkT > 0) return;
    this.honkT = ACCIDENT.honk[0] + this.rng.next() * (ACCIDENT.honk[1] - ACCIDENT.honk[0]);
    const bx = this.x - Math.sin(this.heading) * 16, by = this.y - Math.cos(this.heading) * 16;
    if (this.traffic.carsNear(bx, by, 12) > 2) this.fx.honk(bx, by);
  }

  /** La patrouille part de la couronne, hors de vue, vers la scène, gyrophares allumés. */
  private callPolice(): void {
    const c = this.traffic.spawnEvent(true, { x: this.x, y: this.y });
    if (!c) {
      // Pas de place pour une voiture de police : on réessaie dans 5 s.
      this.phaseT = this.policeAt - 5;
      return;
    }
    this.police = c.id;
    this.traffic.pursue(c.id, this.target);
    this.phase = "police";
    this.phaseT = 0;
  }

  private policeStep(): void {
    const c = this.traffic.eventCar(this.police);
    if (!c) return this.finish(this.outcome ?? "termine");
    if (Math.hypot(c.state.x - this.target.x, c.state.y - this.target.y) > ACCIDENT.parkReach || Math.abs(c.state.speed) > 0.6) return;
    // Garée près de la scène, gyrophares allumés : un gendarme descend vers les conducteurs.
    this.traffic.pursue(c.id, null);
    this.traffic.hold(c.id, 1e6);
    this.traffic.setSiren(c.id, true);
    const h = c.state.heading;
    this.gendarme = this.peds.appear(c.state.x - Math.cos(h) * 1.4, c.state.y + Math.sin(h) * 1.4, c.driver, h, gendarmeRecipe(c.driver));
    if (this.gendarme >= 0) this.fx.say(this.gendarme, "Bonjour, vos papiers.", 3);
    this.phase = "constat";
    this.phaseT = 0;
  }

  /** Le constat : le gendarme rejoint les conducteurs, qui se calment et l'écoutent. */
  private constatStep(_dt: number): void {
    const g = this.gendarme;
    const [a, b] = this.drivers;
    let cx = this.x, cy = this.y, n = 0;
    for (const d of [a, b]) {
      if (!this.here(d)) continue;
      this.peds.position(d, tmp);
      cx = n ? (cx + tmp.x) / 2 : tmp.x;
      cy = n ? (cy + tmp.y) / 2 : tmp.y;
      n++;
    }
    if (this.here(g)) {
      this.peds.position(g, tmp);
      const d = Math.hypot(tmp.x - cx, tmp.y - cy);
      if (d > 2.2) this.peds.command(g, ORDER.seek, cx, cy, 1.5);
      else this.peds.command(g, ORDER.hold, cx, cy, 0, LIFE_POSE.talk);
      for (const dr of [a, b]) if (this.here(dr)) this.peds.command(dr, ORDER.hold, tmp.x, tmp.y, 0, 0);
    }
    if (this.phaseT > ACCIDENT.constat) {
      this.outcome = this.outcome === "vole" ? "vole" : "constat";
      this.phase = "depart";
      this.phaseT = 0;
      if (this.here(g)) this.fx.say(g, "Circulez !", 2.5);
    }
  }

  /** Chacun remonte dans sa voiture (il disparaît en y arrivant) ; les voitures restent, feux de détresse, jusqu'à ce que le joueur ne les voie plus. */
  private departStep(): void {
    const go = (slot: number, car: EventCarView | null): boolean => {
      if (!this.here(slot)) return true;
      if (!car) {
        this.peds.release(slot);
        return true;
      }
      const h = car.state.heading, dx = car.state.x - Math.cos(h) * 1.3, dy = car.state.y + Math.sin(h) * 1.3;
      this.peds.position(slot, tmp);
      if (Math.hypot(tmp.x - dx, tmp.y - dy) < 0.6) {
        this.peds.vanish(slot);
        return true;
      }
      this.peds.command(slot, ORDER.seek, dx, dy, 1.4);
      return false;
    };
    const done = [go(this.drivers[0], this.carOf(0)), go(this.drivers[1], this.carOf(1)), go(this.gendarme, this.police >= 0 ? this.traffic.eventCar(this.police) : null)];
    if (done.every(Boolean) || this.phaseT > 30) this.finish(this.outcome ?? "constat");
  }

  markers(out: EventMarker[]): void {
    if (!this.done) out.push({ kind: "scene", x: this.x, y: this.y });
  }

  items(_out: GroundItem[]): void {}

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    for (const s of this.drivers) if (this.here(s)) this.peds.release(s);
    // Le gendarme ne se mêle pas à la foule : il remonte (il disparaît).
    if (this.here(this.gendarme)) this.peds.vanish(this.gendarme);
    for (const s of this.onlookers) if (this.here(s)) this.peds.release(s);
    // Les voitures restent jusqu'à ce que le joueur ne les voie plus (feux de détresse) ; la patrouille repart.
    for (const id of this.cars) {
      if (id < 0 || !this.traffic.eventCar(id)) continue;
      this.traffic.letGo(id);
      this.traffic.setHazard(id, true);
    }
    if (this.police >= 0 && this.traffic.eventCar(this.police)) {
      this.traffic.hold(this.police, 0);
      this.traffic.letGo(this.police);
    }
    this.done = true;
  }

  abort(): void {
    if (this.done) return;
    this.finish(this.outcome ?? "abandonne");
  }
}
