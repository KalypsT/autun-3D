/**
 * Niveau de recherche (J4, D70) : logique pure. Les infractions arrivent par `report` ; le niveau (0 à `MAX_STARS` étoiles) monte selon
 * l'infraction et selon qui l'a vue, et redescend quand la police perd la piste.
 *
 * Analogie : un chien de piste. Tant qu'un policier te voit, il a l'odeur fraîche (« dernière position connue ») ; dès qu'il te perd, il fouille un
 * cercle autour de cet endroit (la zone de recherche). Hors du cercle et hors de vue, la piste refroidit vite ; dans le cercle, lentement.
 * Au bout du délai propre au niveau, il lâche une étoile, et la fouille recommence autour du même point pour le niveau d'en dessous.
 *
 * Témoins : un policier qui voit l'infraction la compte tout de suite ; un passant (ou le conducteur dont on prend la voiture) téléphone :
 * l'infraction compte après un délai, et seulement si elle est de celles que les passants signalent.
 */

export const MAX_STARS = 3;

export type Crime =
  /** Prendre une voiture avec son conducteur (le conducteur témoigne toujours). */
  | "carjack"
  /** Prendre un véhicule garé. */
  | "theft"
  /** Renverser un passant (chute : événement `hit` de `PedSim`). */
  | "hit_ped"
  /** Bousculer ou renverser un policier. */
  | "hit_cop"
  /** Percuter une voiture de police (au-delà de `RAM_IMPACT`). */
  | "ram_police"
  /** Rouler à plus de la limite + 20 km/h. */
  | "speeding"
  /** Franchir un feu rouge. */
  | "red_light"
  /** Ne pas s'arrêter quand la police le demande (une étoile devient deux). */
  | "evade";

export type Witness = "police" | "civilian";

interface CrimeRule {
  /** Niveau minimal après l'infraction. */
  min: number;
  /** Étoiles ajoutées au niveau courant (si le résultat dépasse `min`). */
  add: number;
  /** Les passants la signalent (sinon, seule la police compte). */
  civilians: boolean;
}

export const CRIMES: Record<Crime, CrimeRule> = {
  carjack: { min: 1, add: 0, civilians: true },
  theft: { min: 1, add: 0, civilians: false },
  hit_ped: { min: 1, add: 1, civilians: true },
  hit_cop: { min: 1, add: 1, civilians: true },
  ram_police: { min: 1, add: 1, civilians: false },
  speeding: { min: 1, add: 0, civilians: false },
  red_light: { min: 1, add: 0, civilians: false },
  evade: { min: 2, add: 0, civilians: false },
};

/** Délai d'un signalement par téléphone (s). */
export const CALL_DELAY = 6;
/** Une même infraction qui ajoute des étoiles ne compte qu'une fois dans cet intervalle (s) : un carambolage de passants n'est pas trois étoiles d'un coup. */
export const REPEAT_WINDOW = 3;
/** Impact minimal (m/s) contre une voiture de police pour compter comme une infraction. */
export const RAM_IMPACT = 1.5;
/** Rayon de la zone de recherche (m) par niveau (indice = étoiles). */
export const SEARCH_RADIUS = [0, 80, 120, 160] as const;
/** Temps hors de vue (s) pour perdre une étoile, par niveau. */
export const ESCAPE_TIME = [0, 15, 25, 40] as const;
/** Dans la zone de recherche, la piste refroidit à cette fraction de la vitesse normale. */
export const INSIDE_RATE = 1 / 3;

/** Ce que l'interface et les autres systèmes lisent (aucune allocation par image). */
export interface WantedView {
  stars: number;
  /** Un policier voit le joueur en ce moment. */
  seen: boolean;
  /** Progression de la fuite pour l'étoile courante (0 à 1) ; 0 quand on est vu ou sans étoile. */
  escape: number;
  /** Dernière position connue de la police et rayon de la zone de recherche (0 sans étoile). */
  lastX: number;
  lastY: number;
  radius: number;
}

interface PendingCall {
  crime: Crime;
  x: number;
  y: number;
  t: number;
}

export class Wanted implements WantedView {
  stars = 0;
  seen = false;
  escape = 0;
  lastX = 0;
  lastY = 0;
  radius = 0;
  /** Nombre de changements de niveau (l'interface s'en sert pour faire clignoter une montée). */
  changes = 0;
  /** Dernier niveau atteint par une montée (pour l'annonce) ; remis à 0 par `takeRise`. */
  private rise = 0;
  private cool = 0;
  private time = 0;
  private readonly calls: PendingCall[] = [];
  private readonly lastAdd = new Map<Crime, number>();

  /** Infraction commise en (x, y), vue par la police ou par un passant (qui téléphone). Une infraction que personne ne voit n'est pas signalée. */
  report(crime: Crime, x: number, y: number, witness: Witness): void {
    const rule = CRIMES[crime];
    if (witness === "civilian") {
      if (!rule.civilians) return;
      // Plusieurs appels pour la même infraction en cours : un seul compte.
      for (const c of this.calls) if (c.crime === crime) return;
      this.calls.push({ crime, x, y, t: this.time + CALL_DELAY });
      return;
    }
    this.apply(crime, x, y);
  }

  /** Appels en attente (pour le diagnostic et les tests). */
  get pendingCalls(): number {
    return this.calls.length;
  }

  /** Impose un niveau (essais : `?wanted=N`), dernière position connue en (x, y). */
  set(stars: number, x: number, y: number): void {
    const s = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
    if (s !== this.stars) this.changes++;
    if (s > this.stars) this.rise = s;
    this.stars = s;
    this.lastX = x;
    this.lastY = y;
    this.radius = SEARCH_RADIUS[s] ?? 0;
    this.cool = 0;
    this.escape = 0;
  }

  /** Arrestation ou nouvelle partie : plus d'étoile, plus d'appel en attente. */
  clear(): void {
    this.set(0, 0, 0);
    this.calls.length = 0;
    this.lastAdd.clear();
    this.seen = false;
    this.rise = 0;
  }

  /** Niveau atteint par la dernière montée, une seule fois (0 sinon). */
  takeRise(): number {
    const r = this.rise;
    this.rise = 0;
    return r;
  }

  /**
   * À chaque image jouée : `seen` dit si un policier voit le joueur (en (x, y)). Les appels arrivent, la piste refroidit hors de vue,
   * une étoile tombe au bout de `ESCAPE_TIME`.
   */
  update(dt: number, x: number, y: number, seen: boolean): void {
    this.time += dt;
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]!;
      if (c.t > this.time) continue;
      this.calls.splice(i, 1);
      this.apply(c.crime, c.x, c.y);
    }
    this.seen = seen && this.stars > 0;
    if (this.stars === 0) {
      this.escape = 0;
      return;
    }
    if (this.seen) {
      this.lastX = x;
      this.lastY = y;
      this.cool = 0;
      this.escape = 0;
      return;
    }
    const dx = x - this.lastX, dy = y - this.lastY;
    const inside = dx * dx + dy * dy < this.radius * this.radius;
    this.cool += dt * (inside ? INSIDE_RATE : 1);
    const need = ESCAPE_TIME[this.stars] ?? 1;
    if (this.cool >= need) {
      // Une étoile de moins : la fouille recommence autour du même point, plus petite.
      const s = this.stars - 1;
      this.stars = s;
      this.changes++;
      this.radius = SEARCH_RADIUS[s] ?? 0;
      this.cool = 0;
    }
    this.escape = this.stars > 0 ? Math.min(1, this.cool / (ESCAPE_TIME[this.stars] ?? 1)) : 0;
  }

  private apply(crime: Crime, x: number, y: number): void {
    const rule = CRIMES[crime];
    let add = rule.add;
    if (add > 0) {
      const last = this.lastAdd.get(crime);
      if (last !== undefined && this.time - last < REPEAT_WINDOW) add = 0;
      else this.lastAdd.set(crime, this.time);
    }
    const next = Math.min(MAX_STARS, Math.max(rule.min, this.stars + add));
    // Toute infraction signalée remet la piste à jour, même sans étoile de plus.
    this.lastX = x;
    this.lastY = y;
    this.cool = 0;
    this.escape = 0;
    if (next !== this.stars) {
      this.changes++;
      if (next > this.stars) this.rise = next;
      this.stars = next;
    }
    this.radius = SEARCH_RADIUS[this.stars] ?? 0;
  }
}
