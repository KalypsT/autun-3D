import { MAX_HEALTH } from "../core/health";

const HEART = "M12 20.6l-1.1-1C6 15.2 3 12.4 3 9a4.6 4.6 0 0 1 4.7-4.7c1.7 0 3.4.9 4.3 2.3a5.2 5.2 0 0 1 4.3-2.3A4.6 4.6 0 0 1 21 9c0 3.4-3 6.2-7.9 10.6z";

/** Sous ce niveau (fraction), la jauge devient rouge brique et pulse. */
const LOW = 0.3;

/**
 * Jauge de santé en haut au centre (`#health`), style « affiche » : un disque sombre cerclé de crème avec un cœur, et une barre crème qui se vide.
 * Cachée à santé pleine ; elle apparaît au premier dégât et clignote sous 30 %. Ne touche au DOM que quand la valeur affichée change.
 */
export class HealthHud {
  private readonly bar: HTMLElement;
  private shown = -1;
  private low = false;

  constructor(private readonly el: HTMLElement) {
    el.innerHTML = `<span class="hicon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.2"/><path d="${HEART}"/></svg></span><span class="hbar"><span class="hfill"></span></span>`;
    this.bar = el.querySelector(".hfill")!;
    el.setAttribute("aria-label", "Santé");
  }

  set(hp: number): void {
    const shown = Math.round(hp);
    if (shown === this.shown) return;
    this.shown = shown;
    this.el.classList.toggle("on", shown < MAX_HEALTH);
    this.el.title = `Santé ${shown}`;
    this.bar.style.width = `${(Math.min(shown, MAX_HEALTH) / MAX_HEALTH) * 100}%`;
    const low = shown / MAX_HEALTH < LOW;
    if (low !== this.low) {
      this.low = low;
      this.el.classList.toggle("low", low);
    }
  }
}
