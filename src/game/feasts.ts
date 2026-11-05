import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { Fireworks } from "../core/fireworks";
import type { SeatDef, Seats } from "../core/seats";
import { MUSIC_SPOTS } from "../core/week";
import type { HeightField } from "../data/types";
import { FeastLights, type LampPoint } from "../render/feast-lights";
import { FireworksView } from "../render/fireworks";
import type { TileExtras } from "../render/tile-manager";

/** Sapin de Noël : dans l'allée piétonne centrale du parking du Champ de Mars (D154). */
export const FIR_TREE = { x: -36, y: -51 } as const;
/** Les guirlandes ne sont tendues que dans le centre (à moins de 450 m de ce point, entre la mairie et la cathédrale). */
const CENTRE = { x: 10, y: -250, r: 450 } as const;

/** Ce que les fêtes demandent au son. */
export interface FeastAudio {
  firework(x: number, y: number, z: number, size: number): void;
  music(dt: number, groups: readonly { x: number; y: number; key: number }[]): void;
}

/**
 * Les fêtes dans le jeu (D202) : illuminations de Noël (guirlandes entre les lampadaires du centre, sapin), feu d'artifice du 14 juillet
 * au-dessus du plan d'eau du Vallon, musiciens de la fête de la musique. Le marché de Noël est tenu par le marché (`market.ts`).
 */
export class FeastsController {
  private lights: FeastLights | null = null;
  private fireworks: Fireworks | null = null;
  private fwView: FireworksView | null = null;
  private music = false;
  private tree = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    private readonly seats: Seats | null,
    private readonly audio: FeastAudio | null,
    private readonly extras: () => Iterable<TileExtras>,
  ) {}

  update(dt: number, feasts: readonly string[], hour: number, night: number): void {
    // Illuminations : construites la première fois, avec les lampadaires des tuiles chargées du centre.
    const lit = feasts.includes("illuminations");
    if (lit && !this.lights) {
      const lamps: LampPoint[] = [];
      for (const t of this.extras()) for (const f of t.furniture) {
        if (f.kind === "street_lamp" && Math.hypot(f.x - CENTRE.x, f.y - CENTRE.y) < CENTRE.r) lamps.push({ x: f.x, y: f.y, z: this.terrain.heightAt(f.x, f.y) });
      }
      this.lights = new FeastLights(this.scene, lamps, { ...FIR_TREE, z: this.terrain.heightAt(FIR_TREE.x, FIR_TREE.y) });
    }
    this.lights?.update(lit, night);
    if (lit !== this.tree) {
      this.tree = lit;
      this.colliders.removeTag("sapin");
      if (lit) {
        this.colliders.currentTag = "sapin";
        this.colliders.addCircle(FIR_TREE.x, FIR_TREE.y, 2.6);
        this.colliders.currentTag = null;
      }
    }

    // Feu d'artifice : il vit tant qu'il reste des étincelles en l'air.
    if (feasts.includes("14-juillet") && !this.fireworks) {
      // Le reflet est au niveau du plan d'eau du Vallon (son fond est creusé, D240).
      const water = this.terrain.waterAt?.(1240, 420) ?? this.terrain.heightAt(1240, 420);
      this.fireworks = new Fireworks(1407, 2400, water);
      this.fwView = new FireworksView(this.scene, 2400, water);
    }
    if (this.fireworks && this.fwView) {
      this.fireworks.step(dt, feasts.includes("14-juillet") ? hour : -1, (x, y, z, size) => this.audio?.firework(x, y, z, size));
      this.fwView.update(this.fireworks);
      if (!feasts.includes("14-juillet") && this.fireworks.particles.length === 0 && this.fireworks.rockets.length === 0) {
        this.fwView.dispose();
        this.fwView = null;
        this.fireworks = null;
      }
    }

    // Fête de la musique : trois places de musiciens par groupe (debout, ils jouent), et la musique.
    const music = feasts.includes("fete-musique");
    if (music !== this.music) {
      this.music = music;
      if (this.seats) {
        if (music) {
          const defs: SeatDef[] = [];
          for (const s of MUSIC_SPOTS) {
            for (const k of [-1, 0, 1]) {
              const x = s.x + Math.cos(s.heading) * k * 1.1, y = s.y - Math.sin(s.heading) * k * 1.1;
              defs.push({ x, y, heading: s.heading, z: this.terrain.heightAt(x, y) + 0.45, kind: "stage" });
            }
          }
          this.seats.addTile("musique", defs);
        } else this.seats.removeTile("musique");
      }
    }
    if (music) this.audio?.music(dt, MUSIC_SPOTS);
  }

  /** Essais : ce qui est montré. */
  get state(): { lights: boolean; fireworks: number; music: boolean } {
    return { lights: this.lights?.bulbs.visible ?? false, fireworks: this.fireworks?.particles.length ?? 0, music: this.music };
  }
}
