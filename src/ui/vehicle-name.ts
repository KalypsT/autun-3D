/**
 * Nom du véhicule (D107), à la manière de GTA 3 : quand on monte dedans, la marque et le modèle s'affichent quelques secondes à droite,
 * sous « Descendre », en grosses capitales de l'affiche, puis s'effacent. Tous les modèles du catalogue ont un nom (D107, D108) ; rien pour un véhicule qui n'en aurait pas.
 */
export class VehicleNameHud {
  private readonly make: HTMLElement;
  private readonly model: HTMLElement;

  constructor(private readonly el: HTMLElement) {
    this.make = document.createElement("div");
    this.make.className = "vn-make";
    this.model = document.createElement("div");
    this.model.className = "vn-model";
    el.append(this.make, this.model);
    el.addEventListener("animationend", () => el.classList.remove("show"));
  }

  show(badge: { make: string; model: string } | undefined): void {
    this.el.classList.remove("show");
    if (!badge) return;
    this.make.textContent = badge.make;
    this.model.textContent = badge.model;
    this.el.setAttribute("aria-label", `${badge.make} ${badge.model}`);
    // Relance l'animation (retirer et remettre la classe après un recalcul de style).
    void this.el.offsetWidth;
    this.el.classList.add("show");
  }

  hide(): void {
    this.el.classList.remove("show");
  }
}
