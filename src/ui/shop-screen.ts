import { formatMoney } from "../core/wallet";
import type { Shop, ShopItem } from "../core/shops";

/** Ce que l'écran d'achat demande au jeu (D322). */
export interface ShopHooks {
  /** « Ouvert jusqu'à 19 h 30 ». */
  hours(): string;
  balance(): number;
  /** Raison d'un refus (« Il manque 4 € », « Santé pleine »), ou null si l'on peut acheter. */
  refusal(item: ShopItem): string | null;
  /** Achète ; renvoie le message à afficher. */
  buy(item: ShopItem): string;
  /** Sortir : le jeu reprend. */
  leave(): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * Écran d'achat (D322) : le nom du commerce, ses horaires, le solde, ce qu'il vend avec son prix et son effet, un bouton « Acheter » par
 * article (grisé avec la raison quand on ne peut pas), et « Sortir ». Le jeu est en pause tant qu'il est ouvert.
 */
export class ShopScreen {
  readonly el: HTMLDivElement;
  private shop: Shop | null = null;
  private hooks: ShopHooks | null = null;
  private note = "";

  constructor() {
    this.el = h("div");
    this.el.id = "shop";
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(shop: Shop, hooks: ShopHooks): void {
    this.shop = shop;
    this.hooks = hooks;
    this.note = "";
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.el.hidden = true;
    this.shop = null;
    this.hooks = null;
  }

  private render(): void {
    const shop = this.shop, hk = this.hooks;
    if (!shop || !hk) return;
    const card = h("div", "sh-card");
    const head = h("div", "sh-head");
    head.append(h("h2", "", shop.name), h("p", "sh-hours", hk.hours()));
    card.append(head, h("p", "sh-balance", `Solde : ${formatMoney(hk.balance())}`));
    for (const item of shop.items) {
      const row = h("div", "sh-row");
      const what = h("span", "sh-name", item.name);
      if (item.heal) what.append(h("span", "sh-effect", item.heal >= 100 ? " · santé pleine" : ` · +${item.heal} PV`));
      const refusal = hk.refusal(item);
      const buy = h("button", "sh-buy", refusal ?? "Acheter");
      buy.disabled = refusal !== null;
      buy.addEventListener("click", () => {
        this.note = hk.buy(item);
        this.render();
      });
      row.append(what, h("strong", "sh-price", formatMoney(item.price)), buy);
      card.append(row);
    }
    if (this.note) card.append(h("p", "sh-note", this.note));
    const out = h("button", "sh-leave", "Sortir");
    out.addEventListener("click", () => hk.leave());
    card.append(out);
    this.el.replaceChildren(card);
  }
}
