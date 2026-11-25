import { formatMoney, signedMoney, type MoneyChange } from "../core/wallet";

/**
 * Argent à l'écran (D317) : le solde sous l'horloge et la date, toujours visible en jeu ; chaque gain fait monter un « +250 € » ocre, chaque
 * dépense un « −30 € » rouge brique, qui s'effacent seuls (trois au plus à la fois).
 */
export class MoneyHud {
  private readonly value: HTMLElement;
  private shown = -1;

  constructor(private readonly el: HTMLElement) {
    this.value = el.querySelector(".m-value") ?? el;
  }

  set(balance: number, changes: readonly MoneyChange[]): void {
    if (balance !== this.shown) {
      this.shown = balance;
      this.value.textContent = formatMoney(balance);
    }
    for (const c of changes) this.pop(c);
  }

  private pop(c: MoneyChange): void {
    const pops = this.el.querySelectorAll(".m-pop");
    if (pops.length >= 3) pops[0]!.remove();
    const s = document.createElement("span");
    s.className = `m-pop ${c.amount >= 0 ? "gain" : "loss"}`;
    s.textContent = signedMoney(c.amount);
    s.title = c.label;
    s.addEventListener("animationend", () => s.remove());
    this.el.appendChild(s);
  }
}
