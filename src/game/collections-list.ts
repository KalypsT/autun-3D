import type { CollectionDef } from "../core/collections";
import { monumentCollection, parseFiches } from "../core/monuments";
import type { TreasureSite } from "../core/treasure-placer";
import fichesMd from "../../docs/fiches-monuments.md?raw";
import treasures from "../data/treasures.json";
import { cacheId, CACHES } from "../core/pickups";
import { WEAPONS } from "../core/weapons";

/** Pièces d'or cachées sur les toits (D321) : prime de chacune, bonus de la collection complète. */
export const TREASURE_REWARD = 150;
export const TREASURES_BONUS = 5000;
/** On ramasse une pièce à moins de … m (vue de dessus), sur son toit. */
const TREASURE_REACH = 1.3;

export const TREASURE_SITES = treasures as TreasureSite[];

/** Les pièces d'or : une entrée par pièce, groupées par quartier, l'altitude du toit pour ne pas les prendre depuis la rue. */
function treasureCollection(): CollectionDef {
  return {
    id: "tresors",
    label: "Pièces d'or",
    bonus: TREASURES_BONUS,
    entries: TREASURE_SITES.map((t, i) => ({ id: t.id, name: `Statère n° ${i + 1}`, x: t.x, y: t.y, z: t.z, radius: TREASURE_REACH, reward: TREASURE_REWARD, group: t.group })),
    hint: `Chacune rapporte ${TREASURE_REWARD} €. Elles sont sur les toits : on les entend tinter à l'approche.`,
  };
}

/** Caches d'armes (D324) : notées quand on prend l'arme (rayon nul), sans prime ; elles ne reviennent plus. */
function cacheCollection(): CollectionDef {
  const group = (w: string): string => (WEAPONS[w as keyof typeof WEAPONS].kind === "melee" ? "Armes blanches" : w === "pistol" ? "Pistolets" : "Fusils");
  return {
    id: "caches",
    label: "Caches",
    bonus: 0,
    entries: CACHES.map((c) => ({ id: cacheId(c), name: `${WEAPONS[c.weapon].name} · ${c.label}`, x: c.x, y: c.y, radius: 0, reward: 0, group: group(c.weapon) })),
    hint: "Une cache prise ne revient plus : les armes et les munitions s'achètent chez James et au Surplus Éduen.",
  };
}

/** Les collections du jeu (D319) : les monuments, avec leurs fiches lues dans `docs/fiches-monuments.md` (D320), et les pièces d'or des toits (D321). */
export const COLLECTIONS: readonly CollectionDef[] = [monumentCollection(parseFiches(fichesMd)), treasureCollection(), cacheCollection()];
