import { describe, expect, it } from "bun:test";
import { WalletLedgerEntry } from "../../../src/domain/entities/wallet-ledger-entry.entity";
import { LedgerDirection } from "../../../src/domain/enums/ledger-direction.enum";
import { InvalidMoneyError } from "../../../src/domain/errors/invalid-money.error";
import { Money } from "../../../src/domain/value-objects/money.vo";

describe("WalletLedgerEntry Entity (Imutável)", () => {
  const baseProps = {
    id: "entry-001",
    walletId: "wallet-01",
    transactionId: "tx-001",
    money: Money.from({ amount: "25.00", currency: "BRL" }),
  };

  it("deve criar uma entrada de ledger de débito balanceada com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Debit,
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "75.00", currency: "BRL" }),
    });

    expect(entry.id).toBe("entry-001");
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it("deve criar uma entrada de ledger de crédito balanceada com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Credit,
      balanceBefore: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "75.00", currency: "BRL" }),
    });

    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.isBalanced()).toBe(true);
  });

  it("deve falhar se a equação contábil (balanceBefore ± money === balanceAfter) for violada no débito", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        direction: LedgerDirection.Debit,
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }), // deveria ser 75.00
      }),
    ).toThrow(InvalidMoneyError);
  });

  it("deve falhar se a equação contábil for violada no crédito", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        direction: LedgerDirection.Credit,
        balanceBefore: Money.from({ amount: "50.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }), // deveria ser 75.00
      }),
    ).toThrow(InvalidMoneyError);
  });

  it("deve ser reidratada corretamente a partir do estado", () => {
    const date = new Date("2026-05-01T12:00:00.000Z");
    const entry = WalletLedgerEntry.rehydrate({
      ...baseProps,
      direction: LedgerDirection.Credit,
      balanceBefore: Money.from({ amount: "10.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "35.00", currency: "BRL" }),
      createdAt: date,
    });

    expect(entry.createdAt).toEqual(date);
    expect(entry.isBalanced()).toBe(true);
  });
});
