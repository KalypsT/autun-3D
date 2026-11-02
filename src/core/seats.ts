/**
 * Places assises de la ville (D198) : bancs et chaises de terrasse des tuiles chargées, que les passants réservent pour s'y asseoir.
 * Logique pure : le rendu les déclare en construisant les tuiles (`addTile`), le jeu les retire quand la tuile part (`removeTile`).
 *
 * Analogie : le plan de salle d'un restaurant ; chaque place a sa chaise et son occupant (ou personne).
 */

/** `market` : la place debout d'un marchand derrière son étal (D201) ; `stage` : un musicien de la fête de la musique (D202). */
export type SeatKind = "bench" | "terrace" | "market" | "stage";

/** Une place : position (repère du jeu), cap du regard une fois assis (rad, 0 = nord, sens horaire), hauteur de l'assise (m). */
export interface Seat {
  x: number;
  y: number;
  heading: number;
  z: number;
  kind: SeatKind;
  /** Emplacement du passant assis, −1 : libre. */
  occupant: number;
}

/** Une place telle que la construction d'une tuile la déclare. */
export type SeatDef = Omit<Seat, "occupant">;

/** Trois places le long d'un banc de 1,6 m (`rot` : direction de la longueur du banc, rad, sens trigonométrique depuis l'est, comme `props.ts`), le dos au dossier. */
export function benchSeats(x: number, y: number, z: number, rot: number): SeatDef[] {
  const ax = Math.cos(rot), ay = Math.sin(rot);
  // Le dossier est posé du côté (sin rot, −cos rot) (voir `buildFurniture`) : on regarde de l'autre côté, assis un peu vers le dossier.
  const fx = -Math.sin(rot), fy = Math.cos(rot);
  const heading = Math.atan2(fx, fy);
  return [-0.5, 0, 0.5].map((s) => ({ x: x + ax * s - fx * 0.04, y: y + ay * s - fy * 0.04, heading, z: z + 0.46, kind: "bench" as const }));
}

export class Seats {
  private readonly tiles = new Map<string, Seat[]>();

  addTile(id: string, defs: readonly SeatDef[]): void {
    this.removeTile(id);
    if (defs.length) this.tiles.set(id, defs.map((d) => ({ ...d, occupant: -1 })));
  }

  /** La tuile part : ses places disparaissent (un passant assis s'en apercevra au pas suivant et se relèvera). */
  removeTile(id: string): void {
    const list = this.tiles.get(id);
    if (list) for (const s of list) s.occupant = -2;
    this.tiles.delete(id);
  }

  get count(): number {
    let n = 0;
    for (const l of this.tiles.values()) n += l.length;
    return n;
  }

  /** La place libre la plus proche de (x, y) à moins de `r`, d'une des sortes `kinds`, ou null. */
  nearestFree(x: number, y: number, r: number, accept: (s: Seat) => boolean): Seat | null {
    let best: Seat | null = null, bd = r * r;
    for (const l of this.tiles.values()) {
      for (const s of l) {
        if (s.occupant !== -1) continue;
        const dx = s.x - x, dy = s.y - y, d = dx * dx + dy * dy;
        if (d < bd && accept(s)) {
          bd = d;
          best = s;
        }
      }
    }
    return best;
  }

  /** Toutes les places (essais, recouvrement de débogage). */
  *all(): IterableIterator<Seat> {
    for (const l of this.tiles.values()) yield* l;
  }
}
