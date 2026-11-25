import type { DirectorContext, EventDef } from "./director";
import { findSnatchSite, SnatchEvent } from "./snatch";
import type { EventEffects, EventPeds } from "./types";

/** Le monde que les événements du catalogue utilisent : passants (null sans foule) et effets. */
export interface EventWorld {
  peds(): EventPeds | null;
  fx: EventEffects;
}

/** Heures où l'on vole à l'arraché : 8 h – 22 h. */
const snatchHours = (h: number): boolean => h >= 8 && h < 22;

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
  ];
}
