import type { DirectorContext, EventDef } from "./director";
import { DogEscapeEvent, findDogOwner, type DogEffects, type EventDogs } from "./dog-escape";
import { findPickpocket, PickpocketEvent, type PickpocketEffects } from "./pickpocket";
import { AccidentEvent, findAccidentSite } from "./accident";
import { PursuitEvent } from "./pursuit";
import { findMalaise, MalaiseEvent } from "./malaise";
import { findRixe, RixeEvent } from "./rixe";
import type { NavGraph } from "../nav-graph";
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
  /** Le graphe piéton (les secours y contournent les murs). */
  pedNav?(): NavGraph | null;
  fx: PickpocketEffects & DogEffects & { honk(x: number, y: number): void; kneel(on: boolean): void; hurtPlayer(damage: number, fromX: number, fromY: number): void };
  /** Bars, cafés et restaurants (où éclatent les rixes). */
  bars?(): readonly { x: number; y: number }[];
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
      kind: "rixe",
      big: true,
      label: "Rixe",
      weight: (ctx: DirectorContext) => {
        // Le soir et la nuit, devant un bar ou un restaurant pas trop loin ; deux fois plus le vendredi et le samedi soir.
        if (!ctx.crowd || !(ctx.hour >= 20 || ctx.hour < 3) || !world.bars) return 0;
        const p = ctx.player;
        if (!world.bars().some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 75)) return 0;
        return (ctx.weekday === 4 || ctx.weekday === 5) && ctx.hour >= 20 ? 2 : 1;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), bars = world.bars?.();
        if (!peds || !bars) return null;
        const site = findRixe(peds, ctx, bars, rng);
        return site ? new RixeEvent(peds, world.traffic?.() ?? null, world.road?.() ?? null, world.pedNav?.() ?? null, world.fx, site, rng) : null;
      },
    },
    {
      kind: "malaise",
      big: true,
      label: "Malaise",
      weight: (ctx: DirectorContext) => {
        if (!ctx.crowd || ctx.hour < 7 || ctx.hour >= 22) return 0;
        // Plus souvent l'après-midi (la chaleur) et les matins de marché (la foule).
        return 1.5 * (ctx.hour >= 13 && ctx.hour < 17 ? 1.5 : 1) * (marketMorning(ctx) ? 1.5 : 1);
      },
      start: (ctx, rng) => {
        const peds = world.peds();
        if (!peds) return null;
        const victim = findMalaise(peds, ctx, rng);
        return victim >= 0 ? new MalaiseEvent(peds, world.traffic?.() ?? null, world.road?.() ?? null, world.pedNav?.() ?? null, world.fx, victim, rng) : null;
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
