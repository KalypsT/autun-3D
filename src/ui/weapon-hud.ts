import type { WeaponDef } from "../core/weapons";

/**
 * Arme en main, dans le bandeau d'état en haut au centre (`#weapon`, caché en véhicule) : pictogramme et nom, plus les munitions pour une arme à feu (J5-3). Un appui passe à l'arme suivante
 * (`onCycle`). Le bouton d'attaque change aussi de pictogramme. Ne touche au DOM que quand quelque chose change.
 */
export class WeaponHud {
  private readonly button: HTMLButtonElement;
  private readonly icon: HTMLElement;
  private readonly name: HTMLElement;
  private readonly ammo: HTMLElement;
  private shown = "";

  constructor(private readonly el: HTMLElement, private readonly attackEl: HTMLElement | null, onCycle: () => void) {
    this.button = document.createElement("button");
    this.icon = document.createElement("span");
    this.icon.className = "wicon";
    this.name = document.createElement("span");
    this.name.className = "wname";
    this.ammo = document.createElement("span");
    this.ammo.className = "wammo";
    this.button.append(this.icon, this.name, this.ammo);
    this.button.addEventListener("click", onCycle);
    el.append(this.button);
    el.setAttribute("aria-label", "Arme");
  }

  /** `ammo` : balles dans le chargeur et en réserve (armes à feu), null pour la mêlée ; `reloading` : ↻ à la place du compte. */
  set(weapon: WeaponDef, ammo: { mag: number; reserve: number; reloading: boolean } | null): void {
    const key = `${weapon.id}/${ammo ? `${ammo.reloading ? "r" : ammo.mag}/${ammo.reserve}` : ""}`;
    if (key === this.shown) return;
    const changed = !this.shown.startsWith(`${weapon.id}/`);
    if (!this.shown) this.el.classList.add("on");
    this.shown = key;
    this.icon.textContent = weapon.icon;
    this.name.textContent = weapon.name;
    // Chargeur en gros, réserve en petit à côté.
    if (ammo) {
      const reserve = document.createElement("small");
      reserve.textContent = `/${ammo.reserve}`;
      this.ammo.replaceChildren(ammo.reloading ? "↻" : String(ammo.mag), reserve);
    } else this.ammo.replaceChildren();
    this.button.title = weapon.name;
    if (this.attackEl) {
      this.attackEl.textContent = weapon.icon;
      this.attackEl.setAttribute("aria-label", weapon.kind === "gun" ? "Tirer" : "Frapper");
    }
    if (changed) {
      this.el.classList.remove("flash");
      void this.el.offsetWidth;
      this.el.classList.add("flash");
    }
  }
}
