import { dataUrl, fetchImage, loadJson } from "../data/load";
import type { MapImageInfo, MapIndex } from "../core/mapview";

/** Formats décrits dans docs/DECISIONS.md (D33) : public/immuable/<version>/data/map/index.json, places.json et les images par kilomètre. */
export interface PlaceCategory {
  id: string;
  label: string;
  group: string;
  glyph: string;
  color: string;
}

export interface Place {
  id: string;
  cat: string;
  name: string;
  x: number;
  y: number;
  kind?: string;
  mhs?: string;
  note?: string;
  story?: string;
}

export interface StreetInfo {
  name: string;
  kind: string;
  /** 0 : grandes rues, 3 : sentiers. */
  rank: number;
  /** Polylignes : x0, y0, x1, y1… */
  lines: number[][];
}

export interface PlacesFile {
  version: number;
  attribution: string;
  groups: { id: string; label: string }[];
  categories: PlaceCategory[];
  places: Place[];
  streets: StreetInfo[];
}

/**
 * Nom de la rue la plus proche de (x, y) à moins de `maxDist` m (phase 4 : le journal des événements), écrit pour le milieu d'une phrase
 * (« rue aux Cordiers », « place du Champ de Mars ») ; null si aucune.
 */
export function streetNear(streets: readonly StreetInfo[], x: number, y: number, maxDist = 40): string | null {
  let best: StreetInfo | null = null, bd = maxDist;
  for (const st of streets) {
    for (const l of st.lines) {
      for (let i = 0; i + 3 < l.length; i += 2) {
        const ax = l[i]!, ay = l[i + 1]!, bx = l[i + 2]!, by = l[i + 3]!;
        if (Math.min(ax, bx) - bd > x || Math.max(ax, bx) + bd < x || Math.min(ay, by) - bd > y || Math.max(ay, by) + bd < y) continue;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
        const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
    }
  }
  if (!best) return null;
  return best.name.replace(/^(Rue|Place|Avenue|Boulevard|Chemin|Impasse|Allée|Route|Quai|Cours|Square|Promenade|Passage|Ruelle|Montée|Rond-point|Parvis|Esplanade|Faubourg|Sentier|Voie)\b/, (m) => m.toLowerCase());
}

/** Mémoire des images décodées au-delà de laquelle les moins récemment utilisées sont libérées. */
const IMAGE_BUDGET = 40 * 2 ** 20;

interface Cached {
  img: HTMLImageElement | null;
  bytes: number;
  used: number;
}

/** Fond de carte : index, lieux et images chargées à la demande (une image n'est demandée que quand la vue la touche). */
export class MapData {
  private readonly cache = new Map<string, Cached>();
  private stamp = 0;
  /** Appelé quand une image vient d'arriver (la carte se redessine). */
  onImage: (() => void) | null = null;

  private constructor(readonly index: MapIndex, readonly places: PlacesFile) {}

  static async load(): Promise<MapData> {
    const [index, places] = await Promise.all([loadJson<MapIndex>("map/index.json"), loadJson<PlacesFile>("map/places.json")]);
    return new MapData(index, places);
  }

  /** À appeler une fois par image dessinée : les images utilisées depuis ne sont pas libérées. */
  nextFrame(): void {
    this.stamp++;
  }

  /** Image du niveau `res` pour ce kilomètre, ou null tant qu'elle n'est pas décodée. */
  image(info: MapImageInfo, res: number): HTMLImageElement | null {
    const file = info.files[String(res)];
    return file ? this.fetch(`map/${file}`, res, this.index.size) : null;
  }

  overview(): HTMLImageElement | null {
    const o = this.index.overview;
    return this.fetch(`map/${o.file}`, o.res, Math.max(o.w, o.h) * o.res);
  }

  private fetch(name: string, res: number, size: number): HTMLImageElement | null {
    let c = this.cache.get(name);
    if (!c) {
      const px = Math.round(size / res);
      c = { img: null, bytes: px * px * 4, used: this.stamp };
      this.cache.set(name, c);
      const entry = c;
      // Lue par fetch (D306) et décodée avant d'être montrée : le premier dessin ne bloque pas l'image.
      void fetchImage(dataUrl(name), name).then(
        (img) => {
          entry.img = img;
          this.onImage?.();
        },
        () => this.cache.delete(name),
      );
      this.evict();
    }
    c.used = this.stamp;
    return c.img;
  }

  private evict(): void {
    let total = 0;
    for (const c of this.cache.values()) total += c.bytes;
    if (total <= IMAGE_BUDGET) return;
    const old = [...this.cache.entries()].filter(([, c]) => c.used < this.stamp - 1).sort((a, b) => a[1].used - b[1].used);
    for (const [name, c] of old) {
      if (total <= IMAGE_BUDGET) break;
      this.cache.delete(name);
      total -= c.bytes;
    }
  }
}
