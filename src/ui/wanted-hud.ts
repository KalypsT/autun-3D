import { MAX_STARS, type WantedView } from "../core/wanted";

const STAR = "M12 2.6l2.75 5.95 6.5.72-4.85 4.4 1.35 6.4L12 16.8l-5.75 3.27 1.35-6.4L2.75 9.27l6.5-.72z";

/**
 * Étoiles de recherche en haut au centre (`#wanted`), style « affiche » : un disque par étoile possible, étoile pleine pour le niveau atteint.
 * Cachées sans étoile ; elles clignotent lentement quand la police a perdu la piste, et s'allument d'un coup à chaque montée.
 * Ne touche au DOM que quand quelque chose change.
 */
export class WantedHud {
  private readonly stars: HTMLElement[] = [];
  private shown = -1;
  private lost = false;

  constructor(private readonly el: HTMLElement) {
    for (let i = 0; i < MAX_STARS; i++) {
      const s = document.createElement("span");
      s.className = "wstar";
      s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.2"/><path d="${STAR}"/></svg>`;
      el.append(s);
      this.stars.push(s);
    }
    el.setAttribute("aria-label", "Niveau de recherche");
    // La montée ne joue qu'une fois : sans retirer la classe, son animation masquerait le clignotement de la piste perdue.
    el.addEventListener("animationend", (e) => {
      if (e.animationName === "wrise") el.classList.remove("rise");
    });
  }

  set(w: WantedView): void {
    if (w.stars !== this.shown) {
      const rose = w.stars > this.shown && this.shown >= 0;
      this.shown = w.stars;
      this.el.classList.toggle("on", w.stars > 0);
      this.el.title = `${w.stars} étoile${w.stars > 1 ? "s" : ""}`;
      this.stars.forEach((s, i) => s.classList.toggle("full", i < w.stars));
      if (rose) {
        // Relance l'animation de montée (retirer et remettre la classe après un recalcul de style).
        this.el.classList.remove("rise");
        void this.el.offsetWidth;
        this.el.classList.add("rise");
      }
    }
    const lost = w.stars > 0 && !w.seen && w.escape > 0;
    if (lost !== this.lost) {
      this.lost = lost;
      this.el.classList.toggle("lost", lost);
    }
  }
}
