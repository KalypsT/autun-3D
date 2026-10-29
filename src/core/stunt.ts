/**
 * Compteur de roue arrière et de roue avant (D98) : distance parcourue sur une roue, pour le défi affiché à l'écran.
 * Une figure commence au-delà de START (rad) de cabrage et finit quand la roue retombe ; une figure de moins de MIN_DISTANCE ne compte pas.
 */

const START = 0.05;
const MIN_DISTANCE = 3;
/** Temps (s) pendant lequel le résultat reste affiché après la figure. */
export const STUNT_SHOW = 2;

export type StuntKind = "wheelie" | "stoppie";

export class StuntMeter {
  /** Figure en cours (ou la dernière, pendant `shown` secondes), distance (m) et meilleure distance de chaque figure. */
  kind: StuntKind | null = null;
  distance = 0;
  active = false;
  shown = 0;
  readonly best: Record<StuntKind, number> = { wheelie: 0, stoppie: 0 };

  /** `wheelie` : cabrage du véhicule (rad, positif roue avant en l'air), `speed` : vitesse (m/s). */
  update(wheelie: number, speed: number, dt: number): void {
    const kind: StuntKind | null = wheelie > START ? "wheelie" : wheelie < -START ? "stoppie" : null;
    if (kind && (!this.active || kind !== this.kind)) {
      this.end();
      this.kind = kind;
      this.distance = 0;
      this.active = true;
    }
    if (this.active && !kind) this.end();
    if (this.active) {
      this.distance += Math.abs(speed) * dt;
      this.shown = STUNT_SHOW;
    } else this.shown = Math.max(0, this.shown - dt);
  }

  /** Figure interrompue (chute, descente du véhicule). */
  end(): void {
    if (!this.active) return;
    this.active = false;
    if (this.distance < MIN_DISTANCE) this.shown = 0;
    else if (this.kind) this.best[this.kind] = Math.max(this.best[this.kind], this.distance);
  }

  /** Texte à afficher, vide s'il n'y a rien à montrer. */
  label(): string {
    if (this.shown <= 0 || !this.kind || this.distance < MIN_DISTANCE) return "";
    const name = this.kind === "wheelie" ? "Roue arrière" : "Roue avant";
    const best = this.best[this.kind];
    const record = !this.active && best > 0 && this.distance >= best ? " · record !" : "";
    return `${name} ${Math.round(this.distance)} m${record}`;
  }
}
