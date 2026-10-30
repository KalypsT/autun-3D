/**
 * Garages de réparation (D113) : les vrais garages automobiles d'Autun (lieux `car_repair` de la carte, OpenStreetMap). On s'arrête devant,
 * au volant d'un véhicule abîmé, et on repart réparé, gratuitement pour l'instant (payant quand l'argent existera). Sans effet sur les étoiles.
 * Logique pure : le jeu donne la position et la vitesse du véhicule à chaque image.
 */

export interface Garage {
  name: string;
  x: number;
  y: number;
}

export const GARAGE = {
  /** Distance (m) au point du garage : le point est souvent au milieu du bâtiment, la rue passe devant. */
  reach: 22,
  /** Vitesse (m/s) sous laquelle on est « arrêté », et temps (s) à attendre pour être réparé. */
  still: 1.5,
  wait: 1.2,
} as const;

/** Les garages d'une liste de lieux de la carte (`map/places.json`). */
export function garagesFrom(places: readonly { name?: string; kind?: string; x: number; y: number }[]): Garage[] {
  return places.filter((p) => p.kind === "car_repair").map((p) => ({ name: p.name ?? "Garage", x: p.x, y: p.y }));
}

/** Le garage à portée de (x, y), ou null. */
export function garageAt(garages: readonly Garage[], x: number, y: number): Garage | null {
  let best: Garage | null = null, bd: number = GARAGE.reach;
  for (const g of garages) {
    const d = Math.hypot(g.x - x, g.y - y);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

/** Attente devant un garage : renvoie le garage quand le véhicule abîmé y est resté arrêté assez longtemps (une fois), sinon null. */
export class GarageStop {
  private waited = 0;
  private done = false;

  update(dt: number, garages: readonly Garage[], x: number, y: number, speed: number, needsRepair: boolean): Garage | null {
    const g = needsRepair && Math.abs(speed) < GARAGE.still ? garageAt(garages, x, y) : null;
    if (!g) {
      this.waited = 0;
      this.done = false;
      return null;
    }
    this.waited += dt;
    if (this.done || this.waited < GARAGE.wait) return null;
    this.done = true;
    return g;
  }
}
