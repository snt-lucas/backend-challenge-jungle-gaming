import { describe, expect, it } from "bun:test";
import { Wallet } from "../../../src/domain/entities/wallet.aggregate";
import { CurrencyMismatchError } from "../../../src/domain/errors/currency-mismatch.error";
import { InsufficientFundsError } from "../../../src/domain/errors/insufficient-funds.error";
import { InvalidMoneyError } from "../../../src/domain/errors/invalid-money.error";
import { Money } from "../../../src/domain/value-objects/money.vo";

describe("Wallet Aggregate Root", () => {
  const playerId = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";
  const walletId = "0192f291-27dd-7d3f-8071-5f8685deef37";

  describe("Instanciação e factories estáticas", () => {
    it("deve criar uma nova Wallet através da factory open() com versão inicial 1", () => {
      const initialBalance = Money.from({ amount: "500.00", currency: "BRL" });
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance,
      });

      expect(wallet).toBeDefined();
      expect(wallet.id).toBe(walletId);
      expect(wallet.playerId).toBe(playerId);
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.amount).toBe("500.00");
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toBeInstanceOf(Date);
      expect(wallet.updatedAt).toBeInstanceOf(Date);
    });

    it("deve criar uma nova Wallet com saldo zero padrão", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        currency: "BRL",
      });

      expect(wallet.balance.amount).toBe("0.00");
      expect(wallet.balance.currency).toBe("BRL");
      expect(wallet.version).toBe(1);
    });

    it("deve reidratar estado persistido sem revalidar regras através de rehydrate()", () => {
      const pastDate = new Date("2026-01-01T10:00:00.000Z");
      const updatedDate = new Date("2026-01-02T12:00:00.000Z");

      const wallet = Wallet.rehydrate({
        id: walletId,
        playerId,
        currency: "BRL",
        balance: Money.from({ amount: "1500.50", currency: "BRL" }),
        version: 42,
        createdAt: pastDate,
        updatedAt: updatedDate,
      });

      expect(wallet.id).toBe(walletId);
      expect(wallet.playerId).toBe(playerId);
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.amount).toBe("1500.50");
      expect(wallet.version).toBe(42);
      expect(wallet.createdAt).toEqual(pastDate);
      expect(wallet.updatedAt).toEqual(updatedDate);
    });

    it("deve rejeitar se id ou playerId forem omitidos em open()", () => {
      expect(() =>
        Wallet.open({
          id: "",
          playerId,
          currency: "BRL",
        }),
      ).toThrow();
      expect(() =>
        Wallet.open({
          id: walletId,
          playerId: "",
          currency: "BRL",
        }),
      ).toThrow();
    });

    it("deve rejeitar se currency conflitar com initialBalance.currency em open()", () => {
      expect(() =>
        Wallet.open({
          id: walletId,
          playerId,
          initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
          currency: "USD",
        }),
      ).toThrow(CurrencyMismatchError);
    });

    it("deve rejeitar se nem initialBalance nem currency forem fornecidos", () => {
      expect(() =>
        Wallet.open({
          id: walletId,
          playerId,
        }),
      ).toThrow();
    });

    it("deve rejeitar saldo inicial negativo em open()", () => {
      const negativeMoney = Money.from(
        { amount: "-10.00", currency: "BRL" },
        { allowNegative: true },
      );
      expect(() =>
        Wallet.open({
          id: walletId,
          playerId,
          initialBalance: negativeMoney,
        }),
      ).toThrow(InvalidMoneyError);
    });

    it("não deve permitir chamada direta ao construtor (construtor protegido/privado)", () => {
      // @ts-expect-error Construtor protegido / privado não deve ser invocável diretamente
      expect(() => new Wallet(walletId, playerId, "BRL")).toThrow();
    });
  });

  describe("Operações de Débito (debit)", () => {
    it("deve debitar saldo com sucesso, decrementar saldo e incrementar version", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const initialUpdatedAt = wallet.updatedAt.getTime();
      const debitAmount = Money.from({ amount: "30.00", currency: "BRL" });

      wallet.debit(debitAmount);

      expect(wallet.balance.amount).toBe("70.00");
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt.getTime()).toBeGreaterThanOrEqual(
        initialUpdatedAt,
      );
    });

    it("deve permitir debitar exatamente todo o saldo até 0.00", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      });

      wallet.debit(Money.from({ amount: "50.00", currency: "BRL" }));

      expect(wallet.balance.amount).toBe("0.00");
      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(2);
    });

    it("deve impedir saldo negativo lançando InsufficientFundsError quando o valor excede o saldo", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      });

      const excessiveAmount = Money.from({ amount: "50.01", currency: "BRL" });

      expect(() => wallet.debit(excessiveAmount)).toThrow(
        InsufficientFundsError,
      );

      // Invariante de estado: saldo e version devem permanecer inalterados
      expect(wallet.balance.amount).toBe("50.00");
      expect(wallet.version).toBe(1);
    });

    it("deve rejeitar débito com valor zero ou negativo", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(() => wallet.debit(Money.zero("BRL"))).toThrow(InvalidMoneyError);
    });

    it("deve rejeitar débito com moeda distinta da wallet", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const usdDebit = Money.from({ amount: "10.00", currency: "USD" });

      expect(() => wallet.debit(usdDebit)).toThrow(CurrencyMismatchError);
      expect(wallet.balance.amount).toBe("100.00");
      expect(wallet.version).toBe(1);
    });
  });

  describe("Operações de Crédito (credit)", () => {
    it("deve creditar saldo com sucesso, incrementar saldo e version", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const creditAmount = Money.from({ amount: "250.75", currency: "BRL" });

      wallet.credit(creditAmount);

      expect(wallet.balance.amount).toBe("350.75");
      expect(wallet.version).toBe(2);
    });

    it("deve rejeitar crédito com valor zero ou negativo", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(() => wallet.credit(Money.zero("BRL"))).toThrow(InvalidMoneyError);
    });

    it("deve rejeitar crédito com moeda distinta da wallet", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const eurCredit = Money.from({ amount: "50.00", currency: "EUR" });

      expect(() => wallet.credit(eurCredit)).toThrow(CurrencyMismatchError);
      expect(wallet.balance.amount).toBe("100.00");
      expect(wallet.version).toBe(1);
    });
  });

  describe("Cenário de concorrência e integridade sequencial", () => {
    it("deve processar múltiplos débitos e créditos mantendo versão estrita", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      wallet.debit(Money.from({ amount: "20.00", currency: "BRL" })); // version 2, balance 80.00
      wallet.credit(Money.from({ amount: "50.00", currency: "BRL" })); // version 3, balance 130.00
      wallet.debit(Money.from({ amount: "130.00", currency: "BRL" })); // version 4, balance 0.00

      expect(wallet.balance.amount).toBe("0.00");
      expect(wallet.version).toBe(4);
    });
  });
});
