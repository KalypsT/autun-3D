import { closingHour, hourText, isOpen, openingText, scheduleOf, type ScheduleId } from "./opening";
import { VEHICLE_PRICES } from "./owned";
import { vehicleDef } from "./vehicle-catalog";
import { formatMoney } from "./wallet";
import { reserveCap, WEAPONS, type Inventory, type WeaponId } from "./weapons";

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
  /** Véhicule vendu (modèle du catalogue, D323) : on choisit sa couleur, il est livré devant le magasin. */
  vehicle?: string;
  /** Arme vendue (D324) : l'arme (avec un chargeur plein) ou, avec `ammo`, des munitions pour elle. */
  weapon?: WeaponId;
  /** Munitions seules : nombre de balles (il faut posséder l'arme). */
  ammo?: number;
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
  if (balance < item.price) return `Il manque ${formatMoney(item.price - balance)}`;
  if (item.heal && hp >= maxHp) return "Santé pleine";
  return null;
}

/** Véhicules vendus par genre de commerce (D323) : voitures et motos chez les concessionnaires, vélos et trottinette chez les marchands de cycles. */
const DEALER_STOCK: Readonly<Record<string, readonly string[]>> = {
  car: ["vieille-voiture", "citadine", "compacte", "camionnette", "berline", "break", "petit-suv", "sportive", "scooter-125", "moto-routiere", "moto-sportive"],
  bicycle: ["velo-ville", "trottinette", "vtt"],
};

/** Concessionnaires et marchands de cycles de la carte (Dacia Autun, Peugeot, Cycles Tacnet, Morvan Bike), aux heures des boutiques. */
export function vehicleShops(places: readonly { id: string; cat: string; name?: string; kind?: string | null; x: number; y: number }[]): Shop[] {
  const out: Shop[] = [];
  for (const p of places) {
    const stock = p.cat === "commerce" && p.kind ? DEALER_STOCK[p.kind] : undefined;
    if (!stock || !p.name) continue;
    const items: ShopItem[] = stock.map((m) => {
      const d = vehicleDef(m)!;
      return { id: m, name: d.badge ? `${d.name} · ${d.badge.make} ${d.badge.model}` : d.name, price: VEHICLE_PRICES[m]!, vehicle: m };
    });
    out.push({ id: p.id, name: p.name, kind: p.kind!, x: p.x, y: p.y, reach: p.kind === "car" ? 35 : 11, schedule: scheduleOf(p.kind), items });
  }
  return out;
}

/** Refus d'un achat de véhicule : pas assez d'argent, ou déjà six véhicules. */
export function canBuyVehicle(item: ShopItem, balance: number, full: boolean): string | null {
  if (full) return "Garage plein (6)";
  if (balance < item.price) return `Il manque ${formatMoney(item.price - balance)}`;
  return null;
}

/** Prix des armes (D324). */
export const WEAPON_PRICES: Readonly<Partial<Record<WeaponId, number>>> = { bat: 30, knife: 40, pistol: 400, smg: 1200, shotgun: 900, rifle: 2500, lmg: 6000, sniper: 3500 };
/** Munitions vendues : un chargeur, et son prix (D324). */
export const AMMO_PACKS: Readonly<Partial<Record<WeaponId, { rounds: number; price: number; name: string }>>> = {
  pistol: { rounds: 12, price: 30, name: "Balles de pistolet" },
  shotgun: { rounds: 6, price: 40, name: "Cartouches" },
  smg: { rounds: 32, price: 50, name: "Balles de pistolet-mitrailleur" },
  rifle: { rounds: 30, price: 80, name: "Balles de fusil d'assaut" },
  lmg: { rounds: 100, price: 150, name: "Bande de mitrailleuse" },
  sniper: { rounds: 5, price: 60, name: "Balles de précision" },
};

const armItem = (id: WeaponId): ShopItem => ({ id, name: WEAPONS[id].name, price: WEAPON_PRICES[id]!, weapon: id });
const ammoItem = (id: WeaponId): ShopItem => {
  const a = AMMO_PACKS[id]!;
  return { id: `ammo-${id}`, name: `${a.name} (${a.rounds})`, price: a.price, weapon: id, ammo: a.rounds };
};

/**
 * Le Surplus Éduen (D324) : il n'est pas dans OpenStreetMap ; sa devanture est dessinée d'après photo (D183), 3 avenue Charles-de-Gaulle
 * (mur 7 du bâtiment `BATIMENT0000000348852378`). Le point est devant la vitrine.
 */
export const SURPLUS = { id: "perso:surplus-eduen", name: "Surplus Éduen", x: -30.5, y: 31.5 } as const;

/**
 * Les deux magasins d'armes (D324, choix de l'utilisateur) : **James** (commerce de chasse d'OpenStreetMap) pour les armes de poing et
 * d'épaule, le **Surplus Éduen** pour les armes de guerre et l'équipement ; aux heures des boutiques. Les nouvelles armes (pistolet-
 * mitrailleur, mitrailleuse, grenades, gilet, fumigènes) s'y ajoutent aux lots suivants.
 */
export function weaponShops(places: readonly { id: string; cat: string; name?: string; kind?: string | null; x: number; y: number }[]): Shop[] {
  const out: Shop[] = [];
  const james = places.find((p) => p.cat === "commerce" && p.kind === "hunting" && p.name === "James");
  if (james) out.push({ id: james.id, name: "James", kind: "hunting", x: james.x, y: james.y, reach: 11, schedule: scheduleOf("hunting"),
    items: [armItem("pistol"), armItem("smg"), armItem("shotgun"), armItem("sniper"), ammoItem("pistol"), ammoItem("smg"), ammoItem("shotgun"), ammoItem("sniper")] });
  out.push({ ...SURPLUS, kind: "army", reach: 8, schedule: scheduleOf("army"),
    items: [armItem("knife"), armItem("bat"), armItem("rifle"), armItem("lmg"), ammoItem("rifle"), ammoItem("lmg")] });
  return out;
}

/** Refus d'un achat d'arme : pas assez d'argent, arme déjà possédée, munitions sans l'arme, réserve pleine. */
export function canBuyWeapon(item: ShopItem, balance: number, inv: Pick<Inventory, "has" | "reserveOf">): string | null {
  const id = item.weapon!;
  if (item.ammo) {
    if (!inv.has(id)) return "Il te faut l'arme";
    if (inv.reserveOf(id) >= reserveCap(WEAPONS[id])) return "Réserve pleine";
  } else if (inv.has(id)) return "Déjà à toi";
  if (balance < item.price) return `Il manque ${formatMoney(item.price - balance)}`;
  return null;
}
