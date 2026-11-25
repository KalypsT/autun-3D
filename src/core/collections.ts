/**
 * Carnet de collections (plaisir de jeu, phase 3, D319) : le système commun des choses à trouver dans la ville (monuments, lot 3-4 ;
 * objets cachés sur les toits, lot 3-5). Une collection est une liste d'entrées posées sur la carte ; une entrée se **découvre** quand on
 * entre dans sa zone (un cercle, et pour un objet sur un toit une hauteur), elle rapporte sa prime, et la collection complète rapporte un
 * bonus. Logique pure ; le jeu appelle `check` quelques fois par seconde.
 *
 * Analogie : l'album de vignettes. Chaque vignette a sa case ; la coller rapporte un peu, finir la page rapporte davantage.
 */

export type CollectionId = "monuments" | "tresors" | "caches";

/** Fiche d'une entrée (monuments, D320) : texte, phrase « Le savais-tu ? » (vide s'il n'y en a pas) et sources. */
export interface Fiche {
  text: string;
  didYouKnow: string;
  sources: string;
}

export interface CollectionEntry {
  /** Identifiant stable (enregistré dans la sauvegarde) : ne jamais le changer une fois publié. */
  id: string;
  name: string;
  /** Centre de la zone de découverte (repère du jeu, m) et son rayon. */
  x: number;
  y: number;
  radius: number;
  /** Altitude de l'objet (m) : il faut être à moins de `HEIGHT_REACH` au-dessus ou au-dessous (objets sur les toits). Absente : toute hauteur. */
  z?: number;
  /** Prime (€). */
  reward: number;
  /** Regroupement affiché dans le carnet (grand ou petit monument, quartier d'un objet caché). */
  group?: string;
  /** Fiche lisible dans le carnet une fois l'entrée trouvée. */
  fiche?: Fiche;
}

export interface CollectionDef {
  id: CollectionId;
  /** Nom de l'onglet du carnet. */
  label: string;
  entries: readonly CollectionEntry[];
  /** Bonus quand toute la collection est trouvée (€). */
  bonus: number;
  /** Phrase d'aide sous la liste du carnet. */
  hint?: string;
}

/** Écart de hauteur (m) toléré pour une entrée qui a une altitude. */
export const HEIGHT_REACH = 2.5;

/** Une découverte : l'entrée, sa prime, et le bonus si elle complète la collection (0 sinon). */
export interface Discovery {
  collection: CollectionDef;
  entry: CollectionEntry;
  reward: number;
  bonus: number;
}

/** Ce que la sauvegarde garde du carnet : `collection:entrée` → date du jeu de la découverte (jours écoulés). */
export type SavedNotebook = Record<string, number>;

const key = (c: CollectionId, id: string): string => `${c}:${id}`;

export class Notebook {
  private readonly found = new Map<string, number>();

  constructor(readonly defs: readonly CollectionDef[], saved?: SavedNotebook | null) {
    if (!saved) return;
    // Une entrée inconnue (retirée du jeu, sauvegarde d'une autre version) est oubliée.
    for (const d of defs) for (const e of d.entries) {
      const at = saved[key(d.id, e.id)];
      if (typeof at === "number" && Number.isFinite(at)) this.found.set(key(d.id, e.id), Math.max(0, Math.floor(at)));
    }
  }

  has(c: CollectionId, id: string): boolean {
    return this.found.has(key(c, id));
  }

  /** Date du jeu de la découverte, ou null. */
  when(c: CollectionId, id: string): number | null {
    return this.found.get(key(c, id)) ?? null;
  }

  count(c: CollectionId): number {
    const d = this.defs.find((x) => x.id === c);
    return d ? d.entries.filter((e) => this.has(c, e.id)).length : 0;
  }

  /** La première entrée pas encore trouvée dont la zone contient (x, y, z) : elle est marquée trouvée à `date` et renvoyée, sinon null. */
  check(x: number, y: number, z: number, date: number): Discovery | null {
    for (const d of this.defs) {
      for (const e of d.entries) {
        // Rayon nul : l'entrée ne se découvre pas en passant, le jeu la note lui-même (caches d'armes, D324 : quand on prend l'arme).
        if (e.radius <= 0 || this.has(d.id, e.id)) continue;
        const dx = x - e.x, dy = y - e.y;
        if (dx * dx + dy * dy > e.radius * e.radius) continue;
        if (e.z !== undefined && Math.abs(z - e.z) > HEIGHT_REACH) continue;
        this.found.set(key(d.id, e.id), Math.max(0, Math.floor(date)));
        const complete = d.entries.every((q) => this.has(d.id, q.id));
        return { collection: d, entry: e, reward: e.reward, bonus: complete ? d.bonus : 0 };
      }
    }
    return null;
  }

  /** Note une entrée trouvée (sans zone : le jeu sait quand) ; renvoie la découverte, ou null si elle l'était déjà ou n'existe pas. */
  mark(c: CollectionId, id: string, date: number): Discovery | null {
    const d = this.defs.find((x) => x.id === c), e = d?.entries.find((q) => q.id === id);
    if (!d || !e || this.has(c, id)) return null;
    this.found.set(key(c, id), Math.max(0, Math.floor(date)));
    return { collection: d, entry: e, reward: e.reward, bonus: d.entries.every((q) => this.has(c, q.id)) ? d.bonus : 0 };
  }

  toSave(): SavedNotebook {
    return Object.fromEntries(this.found);
  }
}

/** Carnet enregistré, lu avec méfiance : un objet de dates finies ; null sinon. Les clés inconnues sont écartées par `Notebook`. */
export function parseNotebook(o: unknown): SavedNotebook | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out: SavedNotebook = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && k.length < 80) out[k] = v;
  return out;
}
