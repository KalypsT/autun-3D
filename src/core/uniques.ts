/**
 * Véhicules uniques (D114) : logique pure. Chacun a un seul exemplaire, une place fixe, parfois un horaire (le camion pizza n'est là que le soir) ;
 * il n'est jamais dans la circulation ni sur les places de stationnement ordinaires, ni sur la carte (on le découvre en ville).
 * Détruit, ou laissé loin de sa place, il y revient après un moment, quand le joueur n'est ni près de lui ni près de sa place.
 * Analogie : le pion d'un jeu de société qui retourne à sa case de départ quand personne ne le tient.
 */

export interface UniqueSpot {
  /** Identifiant du véhicule dans la flotte (et dans les sauvegardes : ne jamais le changer). */
  id: string;
  /** Modèle du catalogue. */
  model: string;
  x: number;
  y: number;
  heading: number;
  /** Heures de présence [de, à[ (heure de jeu, 0-24 ; « de » plus grand que « à » : passe minuit) ; absent : toujours là. */
  hours?: readonly [number, number];
}

export const UNIQUES: readonly UniqueSpot[] = [
  // Jeep militaire, dans l'enceinte du Lycée militaire d'Autun, le long de l'allée à l'est du bâtiment principal.
  { id: "unique-jeep-militaire", model: "jeep-militaire", x: 676, y: 36, heading: 2.36 },
  // Camion Pizza du Vallon, sur le parking à l'ouest du Collège du Vallon, de 17 h à 22 h : sur les places de la rangée nord (D177, au repère donné par
  // l'utilisateur), dans le sens des traits (cap 165°), le dos à l'avenue qui longe le parking au nord, la cabine vers le sud ; son comptoir (à gauche, à l'est)
  // donne sur la place voisine, laissée libre.
  { id: "unique-pizza-du-vallon", model: "pizza-du-vallon", x: 499.1, y: 1102.3, heading: 2.88, hours: [17, 22] },
  // Rôtisserie du marché, de 7 h à 13 h, sur le petit parking devant la mairie (entre la rue et le parvis), le long de sa rangée de places,
  // la cabine vers la place du Champ de Mars ; son comptoir (à droite) donne sur les places et la mairie.
  { id: "unique-rotisserie", model: "rotisserie-champ-de-mars", x: 30, y: 41.5, heading: 4.11, hours: [7, 13] },
  // Grumier du Morvan, à l'entrée de la ville côté Morvan : sur le bas-côté de la route de Château-Chinon, juste après la rangée d'arbres, tourné
  // vers la ville comme s'il descendait du Morvan avec son chargement.
  { id: "unique-grumier", model: "grumier-morvan", x: -1101.3, y: 965.1, heading: 2.478 },
];

export const UNIQUE = {
  /** Le joueur est « loin » au-delà de cette distance (m) : un véhicule n'apparaît, ne disparaît ni ne revient sous ses yeux. */
  far: 150,
  /** Un véhicule détruit, ou laissé à plus de `home` m de sa place, y revient après ce temps (s) passé loin du joueur. */
  respawn: 300,
  home: 3,
} as const;

/** Le véhicule est-il de service à cette heure ? */
export function onDuty(spot: UniqueSpot, hour: number): boolean {
  if (!spot.hours) return true;
  const [from, to] = spot.hours, h = ((hour % 24) + 24) % 24;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** Ce que le jeu sait d'un véhicule unique à cette image. */
export interface UniqueView {
  /** L'exemplaire existe (dans la flotte). */
  exists: boolean;
  /** Il est à sa place (à moins de `UNIQUE.home` m). */
  atHome: boolean;
  /** On peut encore s'en servir (pas une épave). */
  usable: boolean;
  /** Le joueur est dedans. */
  ridden: boolean;
  /** Distance du joueur au véhicule, et à la place du véhicule (m). */
  toVehicle: number;
  toHome: number;
}

/** Ce qu'il faut faire : le faire apparaître à sa place, le retirer (fin de service), le remettre à sa place (le retirer d'où il est, puis apparaître). */
export type UniqueAction = "spawn" | "despawn" | "respawn" | null;

/** Décide, image après image, de la vie de chaque véhicule unique. */
export class UniqueKeeper {
  private readonly away = new Map<string, number>();
  private readonly started = new Set<string>();

  decide(spot: UniqueSpot, v: UniqueView, hour: number, dt: number): UniqueAction {
    const duty = onDuty(spot, hour), far = UNIQUE.far;
    const first = !this.started.has(spot.id);
    this.started.add(spot.id);
    if (!v.exists) {
      this.away.delete(spot.id);
      // Au démarrage, il est simplement là (s'il est de service) ; ensuite il n'apparaît que hors de la vue du joueur.
      return duty && (first || v.toHome > far) ? "spawn" : null;
    }
    if (v.ridden) {
      this.away.delete(spot.id);
      return null;
    }
    if (v.atHome && v.usable) {
      this.away.delete(spot.id);
      return !duty && v.toVehicle > far ? "despawn" : null;
    }
    // Détruit ou laissé ailleurs : le compte à rebours ne court que loin du joueur.
    if (v.toVehicle <= far || v.toHome <= far) {
      this.away.set(spot.id, 0);
      return null;
    }
    const t = (this.away.get(spot.id) ?? 0) + dt;
    this.away.set(spot.id, t);
    if (t < UNIQUE.respawn) return null;
    this.away.delete(spot.id);
    return duty ? "respawn" : "despawn";
  }
}
