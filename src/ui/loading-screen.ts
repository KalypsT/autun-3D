/**
 * Écran de chargement (D338) : le diaporama lui-même est dans `index.html` (HTML et CSS seulement, affiché avant même le téléchargement du
 * jeu) ; ce module en écrit l'avancement, puis, le jeu prêt, attend « Touche l'écran pour jouer » et s'efface. Ce toucher est le premier
 * geste de la partie : il débloque le son et le plein écran.
 */
export class LoadingScreen {
  private readonly status: HTMLElement | null;
  private touched: (() => void) | null = null;
  /** Résolue quand l'écran est fermé : par le toucher du joueur, ou tout de suite (`skip`). */
  readonly started: Promise<void>;

  constructor(private readonly el: HTMLElement) {
    this.status = el.querySelector(".ld-status");
    this.started = new Promise((resolve) => {
      this.touched = resolve;
    });
  }

  /** Étape en cours (« Le relief », « La ville »…). */
  step(text: string): void {
    if (this.status && !this.el.classList.contains("ready")) this.status.textContent = text;
  }

  /** Échec du chargement : le message reste affiché, l'écran ne se ferme pas. */
  error(text: string): void {
    this.el.classList.add("error");
    if (this.status) this.status.textContent = text;
  }

  /** Jeu prêt : on attend un toucher (ou une touche du clavier) pour fermer l'écran. */
  ready(): void {
    if (!this.touched) return;
    this.el.classList.add("ready");
    if (this.status) this.status.textContent = "Touche l'écran pour jouer";
    const go = (e: Event): void => {
      e.preventDefault();
      window.removeEventListener("keydown", go);
      this.close();
    };
    this.el.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", go);
  }

  /** Fermeture sans attendre (banc, viewer, captures, paramètres de test). */
  skip(): void {
    this.el.remove();
    this.finish();
  }

  private close(): void {
    this.el.classList.add("gone");
    this.finish();
    // Retiré après le fondu ; les images du diaporama ne sont plus décodées ni animées.
    window.setTimeout(() => this.el.remove(), 800);
  }

  private finish(): void {
    const done = this.touched;
    this.touched = null;
    done?.();
  }
}
