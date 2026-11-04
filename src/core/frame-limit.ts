/**
 * Limite d'images par seconde (D221). Le navigateur appelle la boucle à chaque rafraîchissement de l'écran (120 Hz sur
 * beaucoup de téléphones) : sans limite, le jeu dessine deux fois plus d'images qu'à 60, pour un gain à peine visible,
 * et le téléphone chauffe. On saute donc les appels arrivés trop tôt.
 *
 * L'échéance avance d'un intervalle fixe à chaque image dessinée (et non « maintenant + intervalle ») : sur un écran
 * dont la fréquence n'est pas un multiple de la limite (90 ou 144 Hz), la cadence moyenne reste celle demandée.
 */
export class FrameLimiter {
  private next = -Infinity;

  /**
   * Vrai si l'image de l'instant `now` (ms, horodatage de requestAnimationFrame) doit être dessinée, pour une limite
   * de `fps` images par seconde (0 ou moins : aucune limite).
   */
  ready(now: number, fps: number): boolean {
    if (!(fps > 0)) {
      this.next = -Infinity;
      return true;
    }
    const interval = 1000 / fps;
    // Tolérance : l'horodatage des images varie un peu ; une image à peine en avance est dessinée quand même.
    if (now < this.next - Math.min(2, interval / 4)) return false;
    // En retard de plus d'une image (image lente, onglet en arrière-plan, changement de limite) : on repart d'ici.
    this.next = now - this.next > interval ? now + interval : this.next + interval;
    return true;
  }
}
