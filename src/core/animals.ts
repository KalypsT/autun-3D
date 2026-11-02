/**
 * Les animaux de la ville (plan « ville vivante », § 9, D203) : logique pure. Chaque espèce vit autour du joueur selon l'heure, la saison
 * et le lieu, apparaît hors de vue (ou loin), disparaît quand on s'éloigne. Les chiens seuls réutilisent le chien de D199.
 *
 * - chiens seuls : quartiers d'habitation, de jour ; trottent d'un point à l'autre, reniflent ; aboient quand le joueur passe tout près ;
 * - chats : la nuit, au pied des façades ; immobiles ou qui marchent un peu ; fuient en courant quand on approche ;
 * - canards : sur l'eau (rivières, plan d'eau), en petits groupes qui nagent lentement ; s'écartent du joueur qui approche ;
 * - hérons : au bord de l'eau, immobiles ; s'envolent quand on approche à moins de 18 m ;
 * - martinets : l'été, de 18 h à 21 h 30, en bande au-dessus de la vieille ville (autour de la cathédrale) ;
 * - chauves-souris : au crépuscule (sauf l'hiver), autour des tours de la cathédrale.
 */

import { CATHEDRAL } from "./sound-model";

export type Species = "dog" | "cat" | "duck" | "heron" | "swift" | "bat";

export interface Critter {
  species: Species;
  x: number;
  y: number;
  /** Hauteur au-dessus du sol (oiseaux en vol, chat sur un muret). */
  z: number;
  heading: number;
  speed: number;
  /** Phase d'animation (pattes, ailes). */
  phase: number;
  /** 0 au repos, 1 en marche, 2 en fuite ou en vol, 3 renifle. */
  state: number;
  timer: number;
  /** Cible du déplacement (chien, chat, canard) ; centre de la ronde (oiseaux). */
  tx: number;
  ty: number;
  /** Taille, pelage ou plumage (tiré), graine. */
  size: number;
  coat: number;
  rng: number;
  /** Groupe (canards : ils suivent le premier du groupe). */
  group: number;
}

export const CRITTER = { rest: 0, walk: 1, flee: 2, sniff: 3 } as const;

/** Plafonds par espèce. */
export const CAPS: Record<Species, number> = { dog: 6, cat: 8, duck: 18, heron: 3, swift: 30, bat: 14 };

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number): number => ((((a - b) % TAU) + 3 * Math.PI) % TAU) - Math.PI;

export function rand(c: Critter): number {
  c.rng = (c.rng + 0x6d2b79f5) >>> 0;
  let t = c.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createCritter(species: Species, x: number, y: number, seed: number, group = -1): Critter {
  const c: Critter = { species, x, y, z: 0, heading: 0, speed: 0, phase: 0, state: CRITTER.rest, timer: 0, tx: x, ty: y, size: 1, coat: 0, rng: seed >>> 0, group };
  c.heading = rand(c) * TAU;
  c.size = species === "dog" ? 0.75 + rand(c) * 0.45 : species === "cat" ? 0.9 + rand(c) * 0.2 : 0.9 + rand(c) * 0.2;
  c.coat = Math.floor(rand(c) * 6);
  c.phase = rand(c) * TAU;
  if (species === "swift" || species === "bat") {
    c.tx = x;
    c.ty = y;
    c.z = species === "swift" ? 25 + rand(c) * 25 : 8 + rand(c) * 12;
    c.state = CRITTER.flee;
  }
  return c;
}

/** Quand l'espèce est dehors (0 à 1) : `night` 0 le jour, 1 la nuit noire ; saison 0 printemps … 3 hiver. */
export function presence(species: Species, hour: number, night: number, season: number): number {
  switch (species) {
    case "dog": return hour >= 7 && hour < 20 ? 1 : 0;
    case "cat": return night;
    case "duck": return hour >= 6 && hour < 21.5 ? 1 : 0.3;
    case "heron": return hour >= 6 && hour < 20 ? 1 : 0;
    case "swift": return season === 1 && hour >= 18 && hour < 21.5 && night < 0.6 ? 1 : 0;
    case "bat": return season !== 3 && night > 0.25 && night < 0.95 ? 1 : 0;
  }
}

/** Où le joueur est-il ? Ce que chaque espèce regarde de lui. */
export interface Watcher {
  x: number;
  y: number;
  speed: number;
}

/** Le pas d'un animal ; `inWater` pour les canards (reste dans l'eau) ; renvoie un événement sonore (aboiement, coin-coin, envol) ou null. */
export function stepCritter(c: Critter, dt: number, w: Watcher, inWater: (x: number, y: number) => boolean, leader: Critter | null): "bark" | "quack" | "flap" | null {
  const dpx = c.x - w.x, dpy = c.y - w.y, dp = Math.hypot(dpx, dpy);
  let event: "bark" | "quack" | "flap" | null = null;
  c.timer -= dt;
  switch (c.species) {
    case "dog": {
      if (dp < 7 && c.state !== CRITTER.flee) {
        // Le joueur passe tout près : il s'arrête, le regarde, aboie tout de suite, puis une fois toutes les 4 à 7 s.
        if (c.state !== CRITTER.rest || c.speed > 0) c.timer = 0;
        c.state = CRITTER.rest;
        c.heading += angleDiff(Math.atan2(-dpx, -dpy), c.heading) * Math.min(1, dt * 6);
        if (c.timer <= 0) {
          c.timer = 4 + rand(c) * 3;
          event = "bark";
        }
        c.speed = 0;
        break;
      }
      wander(c, dt, 1.3, 14, null);
      break;
    }
    case "cat": {
      if (dp < 6 || c.state === CRITTER.flee) {
        // Il détale à l'opposé du joueur (et disparaît plus loin : le jeu le retire hors de vue).
        if (c.state !== CRITTER.flee) c.heading = Math.atan2(dpx, dpy) + (rand(c) - 0.5) * 0.8;
        c.state = CRITTER.flee;
        c.speed = 5;
        c.x += Math.sin(c.heading) * c.speed * dt;
        c.y += Math.cos(c.heading) * c.speed * dt;
        break;
      }
      wander(c, dt, 0.6, 5, null);
      break;
    }
    case "duck": {
      // Le premier du groupe choisit sa route sur l'eau ; les autres le suivent à 1 à 2 m.
      if (leader && leader !== c) {
        c.tx = leader.x - Math.sin(leader.heading) * 1.2 * (1 + (c.coat % 3));
        c.ty = leader.y - Math.cos(leader.heading) * 1.2 * (1 + (c.coat % 3)) + ((c.coat % 2) - 0.5) * 1.2;
      } else if (c.timer <= 0 || Math.hypot(c.tx - c.x, c.ty - c.y) < 0.5) {
        c.timer = 6 + rand(c) * 10;
        for (let k = 0; k < 6; k++) {
          const a = rand(c) * TAU, r = 3 + rand(c) * 8;
          const nx = c.x + Math.sin(a) * r, ny = c.y + Math.cos(a) * r;
          if (inWater(nx, ny)) {
            c.tx = nx;
            c.ty = ny;
            break;
          }
        }
      }
      // Le joueur approche : on s'écarte.
      if (dp < 6) {
        c.tx = c.x + (dpx / Math.max(dp, 0.1)) * 4;
        c.ty = c.y + (dpy / Math.max(dp, 0.1)) * 4;
        if (c.timer > 2) {
          c.timer = 1.5;
          if (rand(c) < 0.3) event = "quack";
        }
      }
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      c.speed = d > 0.3 ? Math.min(0.9, 0.25 + d * 0.15) : 0;
      if (d > 0.05) {
        const nx = c.x + (dx / d) * c.speed * dt, ny = c.y + (dy / d) * c.speed * dt;
        if (inWater(nx, ny)) {
          c.x = nx;
          c.y = ny;
        } else c.timer = 0;
        c.heading += angleDiff(Math.atan2(dx, dy), c.heading) * Math.min(1, dt * 2);
      }
      if (rand(c) < dt * 0.02) event = "quack";
      break;
    }
    case "heron": {
      if (c.state !== CRITTER.flee && dp < 18) {
        c.state = CRITTER.flee;
        c.heading = Math.atan2(dpx, dpy);
        event = "flap";
      }
      if (c.state === CRITTER.flee) {
        // Il s'envole, monte en pente douce, et file droit (le jeu le retire au loin).
        c.speed = Math.min(9, c.speed + dt * 6);
        c.z = Math.min(25, c.z + dt * 3);
        c.x += Math.sin(c.heading) * c.speed * dt;
        c.y += Math.cos(c.heading) * c.speed * dt;
      }
      break;
    }
    case "swift":
    case "bat": {
      // Rondes : le martinet tourne vite et large autour de son centre ; la chauve-souris zigzague serré.
      const swift = c.species === "swift";
      const r = swift ? 35 : 12, v = swift ? 13 : 7;
      const turn = swift ? 0.35 : 1.6 + Math.sin(c.phase * 0.37) * 1.5;
      c.heading += turn * dt * (c.coat % 2 ? 1 : -1);
      const ox = c.x - c.tx, oy = c.y - c.ty, od = Math.hypot(ox, oy);
      // Rappel vers le centre quand on s'en écarte.
      if (od > r) c.heading += angleDiff(Math.atan2(-ox, -oy), c.heading) * Math.min(1, dt * 1.5);
      c.speed = v;
      c.x += Math.sin(c.heading) * v * dt;
      c.y += Math.cos(c.heading) * v * dt;
      c.z += Math.sin(c.phase * 0.23) * dt * (swift ? 2 : 3);
      c.z = Math.max(swift ? 18 : 6, Math.min(swift ? 55 : 24, c.z));
      break;
    }
  }
  c.phase = (c.phase + dt * (c.species === "swift" ? 28 : c.species === "bat" ? 34 : c.species === "heron" ? 6 : 2 + c.speed * 5)) % 1000;
  return event;
}

/** Flânerie à terre : vers une cible à moins de `range` m, à l'allure `v` ; arrivé, il s'arrête (renifle) un moment. */
function wander(c: Critter, dt: number, v: number, range: number, ok: ((x: number, y: number) => boolean) | null): void {
  const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
  if (d < 0.3) {
    if (c.state === CRITTER.walk) {
      c.state = c.species === "dog" ? CRITTER.sniff : CRITTER.rest;
      c.timer = 2 + rand(c) * 6;
    }
    c.speed = 0;
    if (c.timer <= 0) {
      const a = rand(c) * TAU, r = range * (0.3 + rand(c) * 0.7);
      const nx = c.x + Math.sin(a) * r, ny = c.y + Math.cos(a) * r;
      if (!ok || ok(nx, ny)) {
        c.tx = nx;
        c.ty = ny;
        c.state = CRITTER.walk;
      }
    }
    return;
  }
  c.speed += (v - c.speed) * Math.min(1, dt * 4);
  c.x += (dx / d) * Math.min(d, c.speed * dt);
  c.y += (dy / d) * Math.min(d, c.speed * dt);
  c.heading += angleDiff(Math.atan2(dx, dy), c.heading) * Math.min(1, dt * 6);
}

/** Point dans un polygone (anneau aplati). */
export function inRing(ring: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans l'un des polygones d'eau (anneau extérieur puis trous). */
export function inWaterPolys(polys: readonly (readonly number[][])[], x: number, y: number): boolean {
  for (const p of polys) {
    if (!p[0] || !inRing(p[0], x, y)) continue;
    let hole = false;
    for (let k = 1; k < p.length; k++) if (inRing(p[k]!, x, y)) hole = true;
    if (!hole) return true;
  }
  return false;
}

/** Centres des rondes d'oiseaux : la cathédrale (martinets autour du clocher, chauves-souris autour des tours). */
export const FLOCK_CENTRE = { x: CATHEDRAL.x, y: CATHEDRAL.y } as const;
