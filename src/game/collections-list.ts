import type { CollectionDef } from "../core/collections";
import { monumentCollection, parseFiches } from "../core/monuments";
import type { TreasureSite } from "../core/treasure-placer";
import fichesMd from "../../docs/fiches-monuments.md?raw";
import treasures from "../data/treasures.json";

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
  };
}

/** Les collections du jeu (D319) : les monuments, avec leurs fiches lues dans `docs/fiches-monuments.md` (D320), et les pièces d'or des toits (D321). */
export const COLLECTIONS: readonly CollectionDef[] = [monumentCollection(parseFiches(fichesMd)), treasureCollection()];
