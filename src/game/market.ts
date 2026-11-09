import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { findStalls } from "../core/parking";
import type { SeatDef, Seats } from "../core/seats";
import { inMarket, marketLevel } from "../core/week";
import type { HeightField } from "../data/types";
import { MarketStalls, type StallPlace } from "../render/market-stalls";
import type { TileExtras } from "../render/tile-manager";
import type { Fleet, Vehicle } from "./vehicles";

/** Étiquette des obstacles des étals (retirés au remballage). */
const STALL_TAG = "market";
/** Part des places de stationnement occupées par un étal au plus fort du marché. */
const STALL_SHARE = 0.8;

const hash = (a: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
};

interface Stashed {
  model: string;
  id: string;
  home: { x: number; y: number; heading: number };
  variant: number;
}

/**
 * Le marché du Champ de Mars dans le jeu (D201) : les étals sur les places de stationnement du grand parking, le mercredi et le vendredi
 * matin ; les voitures garées là disparaissent pendant le marché et reviennent après ; un marchand se tient derrière chaque étal
 * (une place « debout » que la vie de quartier occupe, D198) ; les étals sont des obstacles.
 */
export class MarketController {
  private readonly places: (StallPlace & { key: number; order: number })[] = [];
  private readonly keys = new Set<number>();
  private readonly view: MarketStalls;
  /** Chalets du marché de Noël (D202), créés à la première occasion. */
  private chalets: MarketStalls | null = null;
  private christmas = false;
  private shown = -1;
  private readonly stash: Stashed[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly fleet: Fleet, private readonly colliders: Colliders, private readonly seats: Seats | null, private readonly terrain: HeightField) {
    this.view = new MarketStalls(scene);
  }

  /** Une tuile construite : ses places de stationnement sur le marché deviennent des emplacements d'étals. */
  addTile(t: TileExtras): void {
    const stalls = findStalls(t.marks).filter((s) => inMarket(s.x, s.y));
    for (const s of stalls) {
      const key = Math.imul(Math.round(s.x * 10), 73856093) ^ Math.imul(Math.round(s.y * 10), 19349663);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      // L'étal tourne le dos à la place voisine dos à dos (rangées doubles) : il regarde l'allée.
      const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
      const back = stalls.some((o) => o !== s && Math.abs(Math.sin(o.heading - s.heading)) < 0.2 && ((o.x - s.x) * fx + (o.y - s.y) * fy) > 3 && Math.abs((o.x - s.x) * fy - (o.y - s.y) * fx) < 1.2);
      const h = hash(key);
      this.places.push({ x: s.x, y: s.y, heading: back ? s.heading + Math.PI : s.heading, color: h % 6, key, order: h / 4294967296 });
    }
    this.places.sort((a, b) => a.order - b.order);
    this.shown = -1;
  }

  /** Nombre d'étals montrés à cette heure, ce jour-là (marché de Noël : un tiers des places, en chalets). */
  count(weekday: number, hour: number, christmas = false): number {
    if (christmas) return Math.round(this.places.length * 0.35);
    return Math.round(marketLevel(weekday, hour) * this.places.length * STALL_SHARE);
  }

  update(weekday: number, hour: number, christmas = false): void {
    const n = this.count(weekday, hour, christmas);
    if (n === this.shown && christmas === this.christmas) return;
    const was = this.shown;
    this.shown = n;
    this.christmas = christmas;
    const live = this.places.slice(0, n);
    const ground = (x: number, y: number): number => this.terrain.heightAt(x, y);
    if (christmas && !this.chalets) this.chalets = new MarketStalls(this.scene, 60, true);
    // Les chalets ont des toits rouge sombre ou vert sapin.
    this.chalets?.update(christmas ? live.map((s) => ({ ...s, color: s.color % 2 ? 0 : 2 })) : [], ground);
    this.view.update(christmas ? [] : live, ground);
    this.colliders.removeTag(STALL_TAG);
    if (n > 0) {
      this.colliders.currentTag = STALL_TAG;
      // Étals de 2,6 m (D303 : on les survole).
      for (const s of live) this.colliders.addCircle(s.x, s.y, 1.15, undefined, this.terrain.heightAt(s.x, s.y) + 2.6);
      this.colliders.currentTag = null;
    }
    // Les marchands : une place debout derrière chaque étal.
    if (this.seats) {
      if (n > 0) {
        const defs: SeatDef[] = live.map((s) => {
          const bx = s.x - Math.sin(s.heading) * 0.75, by = s.y - Math.cos(s.heading) * 0.75;
          return { x: bx, y: by, heading: s.heading, z: this.terrain.heightAt(bx, by) + 0.45, kind: "market" };
        });
        this.seats.addTile("marche", defs);
      } else this.seats.removeTile("marche");
    }
    // Les voitures garées sur le marché s'en vont dès l'installation et reviennent au remballage.
    if (n > 0 && was <= 0) this.clearCars();
    else if (n === 0 && was > 0) this.returnCars();
  }

  /**
   * Une voiture laissée ailleurs revient à sa place (D301) : si sa place est sur le marché installé, elle va dans la réserve du marché, qui
   * la ramènera au remballage. Rend vrai quand le marché la prend (l'appelant la retire alors de la flotte).
   */
  holdHome(v: Vehicle): boolean {
    const home = v.home;
    if (this.shown <= 0 || !home || !inMarket(home.x, home.y)) return false;
    this.stash.push({ model: v.def.id, id: v.id, home, variant: v.variant });
    return true;
  }

  private clearCars(): void {
    for (const v of [...this.fleet.vehicles]) {
      const home = v.home;
      if (!home || v.ridden || !inMarket(home.x, home.y)) continue;
      if (Math.hypot(v.state.x - home.x, v.state.y - home.y) > 0.5 || v.damage.health < 100) continue;
      this.stash.push({ model: v.def.id, id: v.id, home, variant: v.variant });
      this.fleet.remove(v);
    }
  }

  private returnCars(): void {
    for (const s of this.stash) this.fleet.add(s.model, s.id, s.home.x, s.home.y, s.home.heading, s.variant, s.home);
    this.stash.length = 0;
  }

  /** Étals montrés (essais). */
  get shownCount(): number {
    return Math.max(0, this.shown);
  }

  get stallCount(): number {
    return this.places.length;
  }
}
