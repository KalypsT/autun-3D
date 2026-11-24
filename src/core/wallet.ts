/**
 * Argent du joueur (plaisir de jeu, phase 3, D317) : un porte-monnaie en euros, entiers, et les tarifs qui ne dépendent pas d'un magasin
 * (facture de l'hôpital, amende, réparation, portefeuille d'un passant). Logique pure.
 *
 * Analogie : le porte-monnaie et le carnet de dépenses. Chaque mouvement porte un nom ; l'interface lit les mouvements récents pour
 * afficher « +250 € » ou « −30 € » à côté du solde, puis les oublie (`drain`).
 */

/** Solde le plus haut (au-delà, une sauvegarde est tenue pour corrompue et ramenée à cette valeur). */
export const MONEY_CAP = 9_999_999;

/** Un mouvement d'argent : montant signé (positif : gain) et ce qui l'a causé. */
export interface MoneyChange {
  amount: number;
  label: string;
}

/** Montant lu avec méfiance (sauvegarde, paramètre d'URL) : entier dans [0, `MONEY_CAP`], 0 sinon. */
export function clampMoney(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), MONEY_CAP);
}

export class Wallet {
  private value: number;
  /** Mouvements pas encore montrés (lus et vidés par l'interface) ; 16 au plus, les plus anciens sont perdus. */
  private readonly pending: MoneyChange[] = [];

  constructor(initial = 0) {
    this.value = clampMoney(initial);
  }

  get balance(): number {
    return this.value;
  }

  /** Gagne `amount` € (arrondi à l'euro, plafonné) ; renvoie ce qui a vraiment été ajouté. */
  earn(amount: number, label: string): number {
    const n = Math.min(clampMoney(amount), MONEY_CAP - this.value);
    if (n > 0) {
      this.value += n;
      this.note(n, label);
    }
    return n;
  }

  /** A-t-on de quoi payer `amount` € ? */
  canPay(amount: number): boolean {
    return this.value >= Math.ceil(Math.max(0, amount));
  }

  /** Paie `amount` € si le solde suffit (achat) ; sinon rien n'est retiré et on renvoie faux. */
  spend(amount: number, label: string): boolean {
    const n = Math.ceil(Math.max(0, amount));
    if (n > this.value) return false;
    if (n > 0) {
      this.value -= n;
      this.note(-n, label);
    }
    return true;
  }

  /** Prélève `amount` €, ou tout ce qui reste s'il en manque (facture, amende : pas de dette) ; renvoie ce qui a été pris. */
  take(amount: number, label: string): number {
    const n = Math.min(Math.ceil(Math.max(0, amount)), this.value);
    if (n > 0) {
      this.value -= n;
      this.note(-n, label);
    }
    return n;
  }

  /** Les mouvements depuis le dernier appel, du plus ancien au plus récent. */
  drain(): MoneyChange[] {
    return this.pending.splice(0, this.pending.length);
  }

  private note(amount: number, label: string): void {
    if (this.pending.length >= 16) this.pending.shift();
    this.pending.push({ amount, label });
  }
}

/** « 1 250 € » : espace insécable entre les milliers (l'espace fine ne se voit pas dans la police du système) et avant le symbole. */
export function formatMoney(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${n < 0 ? "\u2212" : ""}${s}\u00a0€`;
}

/** « +250 € » ou « −30 € » (vrai signe moins). */
export function signedMoney(n: number): string {
  return n >= 0 ? `+${formatMoney(n)}` : formatMoney(n);
}

/** Facture de l'hôpital après une mort : 10 % du solde, 1 000 € au plus (D317). */
export const DEATH_BILL = { rate: 0.1, max: 1000 } as const;
/** Amende après une arrestation : 15 % du solde, 2 500 € au plus (D317). */
export const ARREST_FINE = { rate: 0.15, max: 2500 } as const;

export function deathBill(balance: number): number {
  return Math.min(Math.round(clampMoney(balance) * DEATH_BILL.rate), DEATH_BILL.max);
}

export function arrestFine(balance: number): number {
  return Math.min(Math.round(clampMoney(balance) * ARREST_FINE.rate), ARREST_FINE.max);
}

/**
 * Réparation au garage (D113, payante depuis D317) : 50 € de main-d'œuvre, jusqu'à 600 € selon la santé perdue et 150 € selon la tôle
 * froissée (moyenne des quatre zones, 0 à 1), arrondi à la dizaine : 50 à 800 €.
 */
export const REPAIR = { base: 50, health: 600, body: 150 } as const;

export function repairCost(health: number, zones: Readonly<Record<string, number>>, max = 100): number {
  const lost = Math.min(Math.max(1 - health / max, 0), 1);
  const z = Object.values(zones);
  const crush = z.length ? Math.min(Math.max(z.reduce((a, b) => a + b, 0) / z.length, 0), 1) : 0;
  return Math.round((REPAIR.base + REPAIR.health * lost + REPAIR.body * crush) / 10) * 10;
}

/** Portefeuille d'un passant mis à terre (D317) : une fois sur trois, de 5 à 40 €. */
export const PED_WALLET = { chance: 1 / 3, min: 5, max: 40 } as const;

/** Ce que lâche un passant mis à terre (0 : rien), tiré avec `rand` (dans [0, 1[). */
export function walletDrop(rand: () => number): number {
  if (rand() >= PED_WALLET.chance) return 0;
  return PED_WALLET.min + Math.floor(rand() * (PED_WALLET.max - PED_WALLET.min + 1));
}
