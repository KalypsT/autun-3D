import type { CollectionDef } from "../core/collections";
import { monumentCollection, parseFiches } from "../core/monuments";
import fichesMd from "../../docs/fiches-monuments.md?raw";

/** Les collections du jeu (D319, D320) : les monuments, avec leurs fiches lues dans `docs/fiches-monuments.md`. Les objets cachés suivront (lot 3-5). */
export const COLLECTIONS: readonly CollectionDef[] = [monumentCollection(parseFiches(fichesMd))];
