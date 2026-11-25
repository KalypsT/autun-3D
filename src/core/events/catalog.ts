import type { DirectorContext, EventDef } from "./director";
import { DogEscapeEvent, findDogOwner, type DogEffects, type EventDogs } from "./dog-escape";
import { findPickpocket, PickpocketEvent, type PickpocketEffects } from "./pickpocket";
import { AccidentEvent, findAccidentSite } from "./accident";
import { PursuitEvent } from "./pursuit";
import type { RoadGraph } from "../road-graph";
import { findSnatchSite, SnatchEvent } from "./snatch";
import type { EventPeds, EventTraffic } from "./types";

/** Le monde que les événements du catalogue utilisent : passants (null sans foule), chiens, solde du joueur et effets. */
export interface EventWorld {
  peds(): EventPeds | null;
  dogs?(): EventDogs | null;
  money?(): number;
  /** La circulation (créée seulement si le réglage « Circulation » n'est pas à « Aucune ») et le graphe routier. */
  traffic?(): EventTraffic | null;
  road?(): RoadGraph | null;
  fx: PickpocketEffects & DogEffects & { honk(x: number, y: number): void };
}

/** Heures où l'on vole à l'arraché : 8 h – 22 h ; où l'on fait les poches : 9 h – 20 h ; où l'on promène son chien : 7 h – 20 h. */
const snatchHours = (h: number): boolean => h >= 8 && h < 22;
const pickHours = (h: number): boolean => h >= 9 && h < 20;
const dogHours = (h: number): boolean => h >= 7 && h < 20;
/** Matin de marché (mercredi et vendredi, D201) : plus de pickpockets. */
const marketMorning = (ctx: DirectorContext): boolean => (ctx.weekday === 2 || ctx.weekday === 4) && ctx.hour < 13;

/**
 * Le catalogue des événements faits (§ 3 du plan) : poids selon l'heure, le quartier, la météo ; lancement (recherche du lieu). Les poids sont ceux
 * du plan (vol 3, pickpocket 1, chien 2…) ; le directeur s'occupe du rythme.
 */
export function eventCatalog(world: EventWorld): EventDef[] {
  return [
    {
      kind: "vol",
      big: false,
      label: "Vol à l'arraché",
      weight: (ctx: DirectorContext) => {
        if (!ctx.crowd || !snatchHours(ctx.hour)) return 0;
        const zone = [1, 0.6, 0.2, 0][ctx.zone] ?? 0.2;
        return 3 * zone * (1 - 0.6 * ctx.rain);
      },
      start: (ctx, rng) => {
        const peds = world.peds();
        if (!peds) return null;
        const site = findSnatchSite(peds, ctx, rng);
        return site ? new SnatchEvent(peds, world.fx, site.victim, site.thief, rng) : null;
      },
    },
    {
      kind: "pickpocket",
      big: false,
      label: "Pickpocket",
      weight: (ctx: DirectorContext) => {
        if (!ctx.crowd || !pickHours(ctx.hour) || !world.money) return 0;
        const zone = [1, 0.3, 0, 0][ctx.zone] ?? 0;
        return 1 * zone * (marketMorning(ctx) ? 2 : 1) * (1 - 0.6 * ctx.rain);
      },
      start: (ctx, rng) => {
        const peds = world.peds(), money = world.money;
        if (!peds || !money) return null;
        const slot = findPickpocket(peds, ctx, money(), rng);
        return slot >= 0 ? new PickpocketEvent(peds, world.fx, slot, money) : null;
      },
    },
    {
      kind: "accident",
      big: true,
      label: "Accident",
      weight: (ctx: DirectorContext) => {
        if (!ctx.traffic || !ctx.crowd || ctx.hour < 6 || !world.traffic) return 0;
        const zone = [1, 0.8, 0.8, 0.3][ctx.zone] ?? 0.5;
        // Deux fois plus sous la pluie (et la neige, la brume : la météo passe par `rain`).
        return 2 * zone * (1 + ctx.rain);
      },
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.(), road = world.road?.();
        if (!peds || !traffic || !road) return null;
        const site = findAccidentSite(road, traffic, ctx, rng);
        if (!site) return null;
        const ev = new AccidentEvent(peds, traffic, world.fx, site, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "poursuite",
      big: true,
      label: "Course-poursuite",
      weight: (ctx: DirectorContext) => {
        if (!ctx.traffic || !world.traffic) return 0;
        // Rare, plus souvent le soir et la nuit.
        return ctx.hour >= 20 || ctx.hour < 4 ? 2 : 1;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.();
        if (!peds || !traffic) return null;
        const ev = new PursuitEvent(peds, traffic, world.fx, ctx, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "chien",
      big: false,
      label: "Chien échappé",
      weight: (ctx: DirectorContext) => {
        if (!ctx.crowd || !dogHours(ctx.hour) || ctx.rain > 0.2 || !world.dogs) return 0;
        // Quartiers d'habitation, périphérie, parcs et bords de l'eau ; un peu au centre.
        const zone = [0.4, 1, 0.8, 1][ctx.zone] ?? 0.5;
        return 2 * zone;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), dogs = world.dogs?.();
        if (!peds || !dogs) return null;
        const owner = findDogOwner(peds, dogs, ctx, rng);
        if (owner < 0) return null;
        const dog = dogs.detach(owner);
        return dog ? new DogEscapeEvent(peds, dogs, world.fx, owner, dog, rng) : null;
      },
    },
  ];
}
