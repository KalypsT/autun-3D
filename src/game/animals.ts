import type * as THREE from "three";
import { CAPS, createCritter, CRITTER, FLOCK_CENTRE, inWaterPolys, presence, stepCritter, type Critter, type Species } from "../core/animals";
import { DOG_POSE, type Dog } from "../core/dogs";
import type { NavGraph } from "../core/nav-graph";
import type { HeightField } from "../data/types";
import { BirdView, type BirdKind } from "../render/birds";
import { DogView } from "../render/dogs";
import type { TileExtras } from "../render/tile-manager";

/** Ce que les animaux demandent au son. */
export interface AnimalAudio {
  animal(kind: "bark" | "quack" | "flap" | "swift", x: number, y: number): void;
}

export interface AnimalWorld {
  x: number;
  y: number;
  yaw: number;
  speed: number;
  hour: number;
  night: number;
  season: number;
}

const ALL: readonly Species[] = ["dog", "cat", "duck", "heron", "swift", "bat"];
/** Distance (m) au-delà de laquelle un animal à terre ou sur l'eau disparaît (s'il n'est pas en vue). */
const GROUND_RANGE = 150;

/**
 * Les animaux dans le jeu (D203) : chaque espèce naît hors de vue (ou loin) autour du joueur, selon l'heure, la saison et le lieu, et
 * disparaît quand on s'éloigne ou que son heure passe. Un appel de dessin par espèce présente ; `?animals=0` les coupe tous.
 */
export class AnimalsController {
  readonly critters: Critter[] = [];
  private spawnTimer = 0;
  private seed = 9001;
  /** Polygones d'eau des tuiles chargées : chacun, l'anneau extérieur puis les trous (anneaux aplatis). */
  private water: number[][][] = [];
  private waterKey = "";
  private readonly views = new Map<Species, DogView | BirdView>();
  private readonly dogItems: Dog[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: HeightField,
    private readonly graph: () => NavGraph | null,
    private readonly extras: () => Iterable<TileExtras>,
    private readonly audio: AnimalAudio | null,
    private readonly enabled = true,
  ) {}

  private inWater = (x: number, y: number): boolean => inWaterPolys(this.water, x, y);

  update(dt: number, w: AnimalWorld): void {
    if (!this.enabled) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      this.refreshWater();
      this.spawn(w);
      this.cull(w);
    }
    const leaders = new Map<number, Critter>();
    for (const c of this.critters) if (c.species === "duck" && c.group >= 0 && !leaders.has(c.group)) leaders.set(c.group, c);
    for (const c of this.critters) {
      const ev = stepCritter(c, dt, w, this.inWater, c.species === "duck" ? leaders.get(c.group) ?? null : null);
      if (ev) this.audio?.animal(ev, c.x, c.y);
      // Les martinets crient en passant.
      if (c.species === "swift" && Math.random() < dt * 0.03) this.audio?.animal("swift", c.x, c.y);
    }
    this.draw();
  }

  /** Polygones d'eau des tuiles chargées (refaits quand la liste des tuiles change). */
  private refreshWater(): void {
    const list = [...this.extras()];
    const key = list.map((e) => e.id).join(",");
    if (key === this.waterKey) return;
    this.waterKey = key;
    this.water = list.flatMap((e) => e.water ?? []).filter((p) => p.length > 0);
  }

  private count(s: Species): number {
    let n = 0;
    for (const c of this.critters) if (c.species === s) n++;
    return n;
  }

  private nextSeed(): number {
    this.seed = (Math.imul(this.seed ^ 0x5bd1e995, 0x27d4eb2d) + 0x165667b1) >>> 0;
    return this.seed;
  }

  /** Une naissance par espèce et par demi-seconde au plus, hors du champ de vision (sauf les oiseaux, loin au-dessus). */
  private spawn(w: AnimalWorld): void {
    const r = (): number => this.nextSeed() / 4294967296;
    const hidden = (x: number, y: number): boolean => {
      const a = Math.atan2(x - w.x, y - w.y), d = (((a - w.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      return Math.abs(d) > 1.0;
    };
    for (const s of ALL) {
      const want = Math.round(CAPS[s] * presence(s, w.hour, w.night, w.season));
      if (this.count(s) >= want) continue;
      if (s === "dog" || s === "cat") {
        const g = this.graph();
        if (!g) continue;
        const a = r() * Math.PI * 2, d = 45 + r() * 50, px = w.x + Math.sin(a) * d, py = w.y + Math.cos(a) * d;
        const hit = g.nearest(px, py, 20);
        if (!hit || !hidden(hit.x, hit.y)) continue;
        const zone = g.edgeZone(hit.edge);
        // Chiens seuls dans les quartiers d'habitation et la périphérie ; chats partout sauf la nature.
        if (s === "dog" ? zone !== 1 && zone !== 2 : zone === 3) continue;
        const side = r() < 0.5 ? -1 : 1, off = s === "cat" ? 1.6 : 0.5;
        const c = createCritter(s, hit.x + side * off * Math.cos(a), hit.y - side * off * Math.sin(a), this.nextSeed());
        if (s === "cat") c.size = 0.5 + r() * 0.1;
        this.critters.push(c);
      } else if (s === "duck") {
        // Un groupe de 3 à 5 sur l'eau, à moins de 110 m.
        for (let k = 0; k < 8; k++) {
          const a = r() * Math.PI * 2, d = 30 + r() * 80, px = w.x + Math.sin(a) * d, py = w.y + Math.cos(a) * d;
          if (!this.inWater(px, py) || !hidden(px, py)) continue;
          const g = this.nextSeed(), n = 3 + Math.floor(r() * 3);
          for (let j = 0; j < n && this.count("duck") < CAPS.duck; j++) this.critters.push(createCritter("duck", px + (r() - 0.5) * 2, py + (r() - 0.5) * 2, this.nextSeed(), g));
          break;
        }
      } else if (s === "heron") {
        // Sur la rive (un sommet d'un polygone d'eau), entre 35 et 110 m.
        const pts: [number, number][] = [];
        for (const p of this.water) {
          const ring = p[0];
          if (!ring) continue;
          for (let i = 0; i < ring.length; i += 8) {
            const d = Math.hypot(ring[i]! - w.x, ring[i + 1]! - w.y);
            if (d > 35 && d < 110) pts.push([ring[i]!, ring[i + 1]!]);
          }
        }
        if (pts.length) {
          const [x, y] = pts[Math.floor(r() * pts.length)]!;
          if (hidden(x, y)) this.critters.push(createCritter("heron", x, y, this.nextSeed()));
        }
      } else {
        // Martinets et chauves-souris : autour de la cathédrale, si l'on est à moins de 700 m (500 m pour les chauves-souris).
        if (Math.hypot(w.x - FLOCK_CENTRE.x, w.y - FLOCK_CENTRE.y) > (s === "swift" ? 700 : 500)) continue;
        const a = r() * Math.PI * 2, d = s === "swift" ? r() * 60 : 5 + r() * 15;
        const c = createCritter(s, FLOCK_CENTRE.x + Math.sin(a) * d, FLOCK_CENTRE.y + Math.cos(a) * d, this.nextSeed());
        c.tx = FLOCK_CENTRE.x + (r() - 0.5) * (s === "swift" ? 80 : 30);
        c.ty = FLOCK_CENTRE.y + (r() - 0.5) * (s === "swift" ? 80 : 30);
        this.critters.push(c);
      }
    }
  }

  /** Disparitions : trop loin (et hors de vue), hors de leur heure, enfuis (chat), envolés (héron). */
  private cull(w: AnimalWorld): void {
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const c = this.critters[i]!;
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      const flyer = c.species === "swift" || c.species === "bat";
      const gone =
        (!flyer && d > GROUND_RANGE) ||
        (flyer && (d > 900 || presence(c.species, w.hour, w.night, w.season) === 0)) ||
        (c.species === "cat" && c.state === CRITTER.flee && d > 25) ||
        (c.species === "heron" && c.state === CRITTER.flee && d > 70) ||
        (!flyer && presence(c.species, w.hour, w.night, w.season) === 0 && d > 40);
      if (gone) this.critters.splice(i, 1);
    }
  }

  private view(s: Species): DogView | BirdView {
    let v = this.views.get(s);
    if (!v) {
      v = s === "dog" ? new DogView(this.scene, CAPS.dog) : s === "cat" ? new DogView(this.scene, CAPS.cat, true) : new BirdView(this.scene, s as BirdKind, CAPS[s]);
      this.views.set(s, v);
    }
    return v;
  }

  private draw(): void {
    const ground = this.terrain.ground ?? this.terrain;
    for (const s of ALL) {
      const list = this.critters.filter((c) => c.species === s);
      if (!list.length && !this.views.has(s)) continue;
      const v = this.view(s);
      if (v instanceof DogView) {
        this.dogItems.length = 0;
        list.forEach((c, i) => this.dogItems.push({
          owner: 0, slot: i, x: c.x, y: c.y, heading: c.heading, speed: c.speed, phase: c.phase, size: c.size, coat: c.coat, side: 1,
          pose: c.state === CRITTER.sniff ? DOG_POSE.sniff : c.state === CRITTER.rest && s === "cat" ? DOG_POSE.sit : DOG_POSE.walk,
          sniffT: 0, sniffX: 0, sniffY: 0, rng: 0,
        }));
        v.update(this.dogItems, (x, y) => this.terrain.heightAt(x, y), () => false);
      } else {
        v.update(list.map((c) => ({
          x: c.x, y: c.y, heading: c.heading, phase: c.phase, coat: c.coat, size: c.species === "heron" ? 1.1 : c.size,
          flying: c.state === CRITTER.flee,
          z: c.species === "duck" ? ground.heightAt(c.x, c.y) + 0.06 : c.species === "heron" ? this.terrain.heightAt(c.x, c.y) + c.z : this.terrain.heightAt(c.x, c.y) + c.z,
        })));
      }
    }
  }

  /** Nombre d'animaux par espèce (essais, ligne de diagnostic). */
  counts(): Record<Species, number> {
    const out = { dog: 0, cat: 0, duck: 0, heron: 0, swift: 0, bat: 0 };
    for (const c of this.critters) out[c.species]++;
    return out;
  }
}
