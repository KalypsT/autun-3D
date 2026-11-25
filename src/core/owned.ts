/**
 * Véhicules achetés (plaisir de jeu, phase 3, lot 8, D323) : ce que l'achat donne de plus que le vol. Un véhicule acheté est **à toi** : le
 * prendre n'est pas un vol, il n'est jamais oublié là où tu l'as laissé (D301), sa couleur est celle que tu as choisie ; détruit, l'assurance
 * le livre neuf chez son vendeur une heure de jeu plus tard ; confisqué à une arrestation, il attend à la fourrière (300 €). Six au plus.
 * Logique pure : le jeu tient la flotte et le temps.
 *
 * Analogie : la carte grise et le contrat d'assurance, rangés dans la boîte à gants.
 */

export const MAX_OWNED = 6;
/** Récupérer un véhicule à la fourrière (€). */
export const IMPOUND_FEE = 300;
/** Délai (heures de jeu) avant que l'assurance livre un véhicule détruit. */
export const INSURANCE_HOURS = 1;

/** Prix des véhicules du catalogue (€) ; les uniques, la police et les services ne sont pas à vendre. */
export const VEHICLE_PRICES: Readonly<Record<string, number>> = {
  "velo-ville": 200, trottinette: 300, vtt: 450,
  "scooter-125": 2000, "moto-routiere": 6000, "moto-sportive": 11000,
  "vieille-voiture": 3500, citadine: 6000, compacte: 9000, camionnette: 12000, berline: 13000, break: 13000, "petit-suv": 16000, sportive: 30000,
};

/**
 * Où en est un véhicule : `ok` dans la ville ; `ready` prêt à être livré (assurance ou fourrière payée) ; `wreck` détruit, livré à l'heure
 * `back` ; `impound` à la fourrière.
 */
export type OwnedStatus = "ok" | "ready" | "wreck" | "impound";

export interface OwnedVehicle {
  /** Identifiant dans la flotte (`achat-1`…), gardé d'une livraison à l'autre. */
  id: string;
  model: string;
  variant: number;
  /** Où il est livré : le commerce qui l'a vendu (identifiant de lieu), ou la gendarmerie (fourrière). */
  deliver: string;
  status: OwnedStatus;
  /** Heure de jeu absolue (date × 24 + heure) de la livraison par l'assurance. */
  back?: number;
}

export const GENDARMERIE = "gendarmerie";

export class OwnedVehicles {
  readonly list: OwnedVehicle[] = [];

  constructor(saved?: readonly OwnedVehicle[] | null) {
    if (saved) for (const o of saved) this.list.push({ ...o });
  }

  get full(): boolean {
    return this.list.length >= MAX_OWNED;
  }

  isOwned(id: string): boolean {
    return this.list.some((o) => o.id === id);
  }

  get(id: string): OwnedVehicle | null {
    return this.list.find((o) => o.id === id) ?? null;
  }

  /** Nouveau véhicule acheté chez `shop` : il est prêt à être livré devant le magasin. Null si le garage est plein. */
  buy(model: string, variant: number, shop: string): OwnedVehicle | null {
    if (this.full) return null;
    let n = 1;
    while (this.isOwned(`achat-${n}`)) n++;
    const o: OwnedVehicle = { id: `achat-${n}`, model, variant, deliver: shop, status: "ready" };
    this.list.push(o);
    return o;
  }

  /** Détruit (explosion, panne définitive, noyé) à l'heure `now` : l'assurance le livrera chez son vendeur. */
  wreck(id: string, now: number): void {
    const o = this.get(id);
    if (!o || o.status !== "ok") return;
    o.status = "wreck";
    o.back = now + INSURANCE_HOURS;
  }

  /** Confisqué à une arrestation : à la fourrière. */
  impound(id: string): void {
    const o = this.get(id);
    if (o) {
      o.status = "impound";
      delete o.back;
    }
  }

  /** Fourrière payée : il sera livré devant la gendarmerie. */
  release(id: string): void {
    const o = this.get(id);
    if (o?.status !== "impound") return;
    o.status = "ready";
    o.deliver = GENDARMERIE;
  }

  /** À l'heure `now`, les épaves dont l'assurance est passée deviennent prêtes à être livrées. */
  update(now: number): void {
    for (const o of this.list) {
      if (o.status === "wreck" && o.back !== undefined && now >= o.back) {
        o.status = "ready";
        delete o.back;
      }
    }
  }

  /** Livré : il est de nouveau dans la ville. */
  delivered(id: string): void {
    const o = this.get(id);
    if (o) o.status = "ok";
  }

  toSave(): OwnedVehicle[] {
    return this.list.map((o) => ({ ...o }));
  }
}

/** Véhicules achetés enregistrés, lus avec méfiance : modèles à vendre, identifiants `achat-N` sans doublon, états connus ; six au plus. */
export function parseOwned(o: unknown): OwnedVehicle[] | null {
  if (!Array.isArray(o)) return null;
  const out: OwnedVehicle[] = [];
  for (const r of o as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = r["id"], model = r["model"], variant = r["variant"], deliver = r["deliver"], status = r["status"], back = r["back"];
    if (typeof id !== "string" || !/^achat-\d+$/.test(id) || out.some((q) => q.id === id)) continue;
    if (typeof model !== "string" || !(model in VEHICLE_PRICES)) continue;
    if (typeof variant !== "number" || !Number.isInteger(variant) || variant < 0 || variant > 31) continue;
    if (typeof deliver !== "string" || deliver.length > 80) continue;
    if (status !== "ok" && status !== "ready" && status !== "wreck" && status !== "impound") continue;
    const v: OwnedVehicle = { id, model, variant, deliver, status };
    if (status === "wreck") v.back = typeof back === "number" && Number.isFinite(back) ? back : 0;
    out.push(v);
    if (out.length >= MAX_OWNED) break;
  }
  return out;
}
