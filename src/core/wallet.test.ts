import { describe, expect, it } from "vitest";
import { arrestFine, clampMoney, deathBill, formatMoney, MONEY_CAP, repairCost, signedMoney, Wallet, walletDrop } from "./wallet";

describe("porte-monnaie", () => {
  it("gagne, paie, refuse quand il manque de l'argent", () => {
    const w = new Wallet(100);
    expect(w.earn(250, "Découverte")).toBe(250);
    expect(w.balance).toBe(350);
    expect(w.spend(400, "Achat")).toBe(false);
    expect(w.balance).toBe(350);
    expect(w.spend(50, "Achat")).toBe(true);
    expect(w.balance).toBe(300);
    expect(w.canPay(300)).toBe(true);
    expect(w.canPay(301)).toBe(false);
  });

  it("prélève ce qui reste, sans dette", () => {
    const w = new Wallet(80);
    expect(w.take(200, "Amende")).toBe(80);
    expect(w.balance).toBe(0);
    expect(w.take(10, "Amende")).toBe(0);
  });

  it("note les mouvements pour l'interface, puis les oublie", () => {
    const w = new Wallet();
    w.earn(30, "Portefeuille");
    w.spend(10, "Café");
    w.take(0, "rien");
    expect(w.drain()).toEqual([{ amount: 30, label: "Portefeuille" }, { amount: -10, label: "Café" }]);
    expect(w.drain()).toEqual([]);
  });

  it("lit les montants avec méfiance et plafonne", () => {
    expect(clampMoney("12")).toBe(0);
    expect(clampMoney(-5)).toBe(0);
    expect(clampMoney(Number.NaN)).toBe(0);
    expect(clampMoney(12.9)).toBe(12);
    expect(clampMoney(1e12)).toBe(MONEY_CAP);
    const w = new Wallet(MONEY_CAP - 5);
    expect(w.earn(100, "x")).toBe(5);
    expect(w.balance).toBe(MONEY_CAP);
  });

  it("écrit les montants à la française", () => {
    expect(formatMoney(0)).toBe("0\u00a0€");
    expect(formatMoney(1250)).toBe("1\u00a0250\u00a0€");
    expect(formatMoney(1234567)).toBe("1\u00a0234\u00a0567\u00a0€");
    expect(signedMoney(250)).toBe("+250\u00a0€");
    expect(signedMoney(-30)).toBe("−30\u00a0€");
  });
});

describe("tarifs", () => {
  it("facture de l'hôpital et amende : un pourcentage plafonné", () => {
    expect(deathBill(0)).toBe(0);
    expect(deathBill(1234)).toBe(123);
    expect(deathBill(50000)).toBe(1000);
    expect(arrestFine(1000)).toBe(150);
    expect(arrestFine(50000)).toBe(2500);
  });

  it("réparation de 50 à 800 € selon les dégâts", () => {
    const none = { front: 0, rear: 0, left: 0, right: 0 };
    expect(repairCost(100, none)).toBe(50);
    expect(repairCost(0, { front: 1, rear: 1, left: 1, right: 1 })).toBe(800);
    expect(repairCost(50, { front: 0.4, rear: 0, left: 0, right: 0 })).toBe(370);
  });

  it("un passant lâche un portefeuille une fois sur trois, de 5 à 40 €", () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) % 100000) / 100000;
    let drops = 0, min = Infinity, max = 0;
    for (let i = 0; i < 6000; i++) {
      const n = walletDrop(rand);
      if (n > 0) {
        drops++;
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
    }
    expect(drops / 6000).toBeGreaterThan(0.29);
    expect(drops / 6000).toBeLessThan(0.38);
    expect(min).toBe(5);
    expect(max).toBe(40);
    expect(walletDrop(() => 0.9)).toBe(0);
  });
});
