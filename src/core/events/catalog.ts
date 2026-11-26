import type { DirectorContext, EventDef } from "./director";
import { DogEscapeEvent, findDogOwner, type DogEffects, type EventDogs } from "./dog-escape";
import { findPickpocket, PickpocketEvent, type PickpocketEffects } from "./pickpocket";
import { AccidentEvent, findAccidentSite } from "./accident";
import { PursuitEvent } from "./pursuit";
import { findMalaise, MalaiseEvent } from "./malaise";
import { findRixe, RixeEvent } from "./rixe";
import { EnerveEvent } from "./enerve";
import { findDeliverySpot, LivreurEvent } from "./livreur";
import { ChauffardEvent, findChauffard } from "./chauffard";
import { HALL, MARIAGE, MariageEvent } from "./mariage";
import { FeuEvent, findBin } from "./feu";
import { BraquageEvent, findShop } from "./braquage";
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
  fx: PickpocketEffects & DogEffects & {
    honk(x: number, y: number): void;
    kneel(on: boolean): void;
    hurtPlayer(damage: number, fromX: number, fromY: number): void;
    applause(x: number, y: number, seconds: number): void;
    bells(x: number, y: number, seconds: number): void;
    shoot(x0: number, y0: number, x1: number, y1: number, hit: boolean, damage: number): void;
    dropGun(x: number, y: number): void;
    alarm(x: number, y: number, seconds: number): void;
  };
  /** Commerces ouverts en ce moment (le braquage). */
  openShops?(): readonly { x: number; y: number }[];
  /** Bars, cafés et restaurants (où éclatent les rixes). */
  bars?(): readonly { x: number; y: number }[];
  /** Corbeilles de rue des tuiles chargées (où prend un feu de poubelle). */
  bins?(): readonly { x: number; y: number }[];
  /** La voiture que le joueur vient d'accrocher (le conducteur énervé) : son identifiant, −1 sans. */
  pendingBump?(): number;
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
      // Jamais tiré au hasard : le jeu le lance quand le joueur accroche une voiture (une fois sur quatre, `EventsController`).
      kind: "enerve",
      big: false,
      label: "Conducteur énervé",
      weight: () => 0,
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.();
        if (!peds || !traffic) return null;
        // `?event=enerve` (essais, captures) : sans voiture accrochée, la voiture libre la plus proche à moins de 80 m.
        let id = world.pendingBump?.() ?? -1;
        if (id < 0) {
          const p = ctx.player, near = traffic.freeCars(p.x, p.y, 80).sort((a, b) => Math.hypot(a.state.x - p.x, a.state.y - p.y) - Math.hypot(b.state.x - p.x, b.state.y - p.y));
          id = near[0]?.id ?? -1;
        }
        if (id < 0) return null;
        const ev = new EnerveEvent(peds, traffic, world.fx, id, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "livreur",
      big: false,
      label: "Livreur pressé",
      weight: (ctx: DirectorContext) => {
        // Le matin, du lundi au samedi, surtout au centre.
        if (!ctx.traffic || !world.traffic || ctx.hour < 6 || ctx.hour >= 11 || ctx.weekday > 5) return 0;
        return [1, 0.5, 0.3, 0][ctx.zone] ?? 0.3;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.(), road = world.road?.();
        if (!peds || !traffic || !road) return null;
        const spot = findDeliverySpot(road, ctx, rng);
        if (!spot) return null;
        const ev = new LivreurEvent(peds, traffic, world.pedNav?.() ?? null, world.fx, spot, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "chauffard",
      big: true,
      label: "Accident en direct",
      weight: (ctx: DirectorContext) => {
        if (!ctx.traffic || !world.traffic || ctx.hour < 7 || ctx.hour >= 23) return 0;
        return [1, 0.8, 0.5, 0][ctx.zone] ?? 0.5;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.();
        if (!peds || !traffic) return null;
        const id = findChauffard(traffic, ctx, rng);
        if (id < 0) return null;
        const ev = new ChauffardEvent(peds, traffic, world.fx, id, ctx, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "mariage",
      big: true,
      label: "Cortège de mariage",
      weight: (ctx: DirectorContext) => {
        // Le samedi de 14 h à 18 h, près de l'hôtel de ville : rare, donc favorisé quand il peut avoir lieu.
        if (!ctx.traffic || !ctx.crowd || !world.traffic || ctx.weekday !== 5 || ctx.hour < 14 || ctx.hour >= 18) return 0;
        return Math.hypot(ctx.player.x - HALL.x, ctx.player.y - HALL.y) < MARIAGE.reach ? 4 : 0;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), traffic = world.traffic?.(), road = world.road?.();
        if (!peds || !traffic || !road) return null;
        const ev = new MariageEvent(peds, traffic, road, world.pedNav?.() ?? null, world.fx, ctx, rng);
        return ev.ok ? ev : null;
      },
    },
    {
      kind: "feu",
      big: true,
      label: "Feu de poubelle",
      weight: (ctx: DirectorContext) => {
        if (!world.bins || !(ctx.hour >= 19 || ctx.hour < 5)) return 0;
        return 0.7;
      },
      start: (ctx, rng) => {
        const bin = findBin(world.bins?.() ?? [], ctx, rng);
        if (!bin) return null;
        return new FeuEvent(world.peds(), ctx.traffic ? world.traffic?.() ?? null : null, world.road?.() ?? null, world.pedNav?.() ?? null, world.fx, bin, rng);
      },
    },
    {
      kind: "braquage",
      big: true,
      label: "Braquage",
      weight: (ctx: DirectorContext) => {
        // Le soir (19 h – 23 h), un commerce ouvert à moins de 100 m.
        if (!ctx.crowd || ctx.hour < 19 || ctx.hour >= 23 || !world.openShops || !world.pedNav) return 0;
        const p = ctx.player;
        return world.openShops().some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 100) ? 0.5 : 0;
      },
      start: (ctx, rng) => {
        const peds = world.peds(), nav = world.pedNav?.();
        if (!peds || !nav) return null;
        const shop = findShop(world.openShops?.() ?? [], nav, ctx, rng);
        if (!shop) return null;
        const ev = new BraquageEvent(peds, ctx.traffic ? world.traffic?.() ?? null : null, world.road?.() ?? null, nav, world.fx, shop, rng);
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
