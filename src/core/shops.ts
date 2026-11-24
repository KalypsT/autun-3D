import { closingHour, hourText, isOpen, openingText, scheduleOf, type ScheduleId } from "./opening";

/**
 * Magasins (plaisir de jeu, phase 3, lot 6, D322) : les vrais commerces d'Autun (lieux de `map/places.json`), chacun avec son horaire type
 * (D200) et ce qu'il vend. On entre à pied, à quelques mètres du point du commerce ; l'écran d'achat met le jeu en pause. Ce lot vend à
 * manger et à boire, qui soigne tout de suite (pas de sac) ; les armes (lot 7) et les véhicules (lot 8) passeront par le même comptoir.
 * Logique pure.
 */

export interface ShopItem {
  id: string;
  name: string;
  /** Prix (€, entier). */
  price: number;
  /** Points de vie rendus (100 : santé pleine). */
  heal?: number;
}

export interface Shop {
  id: string;
  name: string;
  /** Genre OpenStreetMap (`bakery`, `fast_food`…). */
  kind: string;
  x: number;
  y: number;
  /** Distance (m) au point du commerce où l'on peut entrer : le point OpenStreetMap est souvent au milieu du bâtiment. */
  reach: number;
  schedule: ScheduleId;
  items: readonly ShopItem[];
}

const CAFE: ShopItem = { id: "cafe", name: "Café", price: 2, heal: 5 };
const VIENNOISERIE: ShopItem = { id: "viennoiserie", name: "Viennoiserie", price: 2, heal: 8 };
const SANDWICH: ShopItem = { id: "sandwich", name: "Sandwich", price: 7, heal: 35 };
const DRINK: ShopItem = { id: "boisson", name: "Boisson fraîche", price: 2, heal: 5 };

/** Ce que vend chaque genre de commerce (prix et soins du plan, § 6). */
export const MENUS: Readonly<Record<string, readonly ShopItem[]>> = {
  bakery: [VIENNOISERIE, SANDWICH],
  pastry: [VIENNOISERIE, { id: "patisserie", name: "Pâtisserie", price: 4, heal: 15 }],
  cafe: [CAFE, { id: "croque", name: "Croque-monsieur", price: 7, heal: 35 }],
  coffee: [CAFE, VIENNOISERIE],
  bar: [CAFE, { id: "planche", name: "Planche à partager", price: 11, heal: 60 }],
  pub: [CAFE, { id: "planche", name: "Planche à partager", price: 11, heal: 60 }],
  fast_food: [{ id: "kebab", name: "Sandwich ou kebab", price: 7, heal: 35 }, { id: "menu", name: "Menu", price: 11, heal: 60 }],
  restaurant: [{ id: "plat", name: "Plat du jour", price: 14, heal: 60 }, { id: "repas", name: "Menu complet", price: 25, heal: 100 }],
  supermarket: [DRINK, SANDWICH],
  convenience: [DRINK, SANDWICH],
  "convenience;gas": [DRINK, SANDWICH],
  deli: [DRINK, { id: "traiteur", name: "Plat du traiteur", price: 11, heal: 60 }],
};

/** Distance d'entrée selon le genre : les grandes surfaces ont leur point loin de la porte. */
function reachOf(kind: string): number {
  if (kind === "supermarket") return 35;
  if (kind === "convenience;gas") return 18;
  return 11;
}

/** Les commerces de bouche de la carte (D322). Une station-service suit l'horaire d'une supérette. */
export function foodShops(places: readonly { id: string; cat: string; name?: string; kind?: string | null; x: number; y: number }[]): Shop[] {
  const out: Shop[] = [];
  for (const p of places) {
    const k = p.kind ?? "";
    const items = p.cat === "commerce" ? MENUS[k] : undefined;
    if (!items || !p.name) continue;
    out.push({ id: p.id, name: p.name, kind: k, x: p.x, y: p.y, reach: reachOf(k), schedule: scheduleOf(k === "convenience;gas" ? "convenience" : k), items });
  }
  return out;
}

/** Le commerce le plus proche à portée d'entrée de (x, y), ou null. */
export function shopAt(shops: readonly Shop[], x: number, y: number): Shop | null {
  let best: Shop | null = null, bd = Infinity;
  for (const s of shops) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.reach && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export function shopOpen(s: Shop, weekday: number, hour: number): boolean {
  return isOpen(s.schedule, weekday, hour);
}

/** « Ouvert jusqu'à 19 h 30 » ou « Fermé · ouvre demain à 7 h ». */
export function shopHours(s: Shop, weekday: number, hour: number): string {
  const end = closingHour(s.schedule, weekday, hour);
  return end !== null ? `Ouvert jusqu'à ${hourText(end)}` : `Fermé · ${openingText(s.schedule, weekday, hour)}`;
}

/** Peut-on acheter cet article ? Raison du refus sinon (pas assez d'argent, santé déjà pleine). */
export function canBuy(item: ShopItem, balance: number, hp: number, maxHp: number): string | null {
  if (balance < item.price) return `Il manque ${item.price - balance} €`;
  if (item.heal && hp >= maxHp) return "Santé pleine";
  return null;
}
