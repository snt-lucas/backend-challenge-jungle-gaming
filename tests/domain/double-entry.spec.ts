import { describe, it, expect } from "bun:test";
import {
  DoubleEntryTransaction,
  DoubleEntryPosting,
  UnbalancedJournalEntryError,
} from "../../src/domain/entities/double-entry-transaction.entity";
import { LedgerDirection } from "../../src/domain/enums/ledger-direction.enum";
import { WagerTransactionKind } from "../../src/domain/enums/wager-transaction-kind.enum";
import { Money } from "../../src/domain/value-objects/money.vo";
import { DomainError } from "../../src/domain/errors/domain.error";

describe("DoubleEntryTransaction — Contabilidade por Partidas Dobradas (Seção 6.4)", () => {
  const walletId = "wal-player-123";
  const providerId = "pragmatic-play";
  const moneyBet = Money.from({ amount: "50.00", currency: "BRL" });
  const moneyWin = Money.from({ amount: "150.00", currency: "BRL" });
  const moneyRefund = Money.from({ amount: "50.00", currency: "BRL" });

  describe("1. Operação de Aposta (BET)", () => {
    it("deve criar uma partida dobrada equilibrada: Débito na Carteira do Jogador e Crédito na Casa (Escrow)", () => {
      const tx = DoubleEntryTransaction.createBet({
        id: "entry-01",
        transactionId: "tx-bet-01",
        walletId,
        providerId,
        money: moneyBet,
      });

      expect(tx.isBalanced()).toBe(true);
      expect(tx.kind).toBe(WagerTransactionKind.Bet);
      expect(tx.postings.length).toBe(2);

      const debitPosting = tx.postings.find((p) => p.direction === LedgerDirection.Debit);
      const creditPosting = tx.postings.find((p) => p.direction === LedgerDirection.Credit);

      expect(debitPosting?.accountId).toBe(`WALLET:${walletId}`);
      expect(debitPosting?.money.amount).toBe("50.00");

      expect(creditPosting?.accountId).toBe(`HOUSE:ESCROW:${providerId}`);
      expect(creditPosting?.money.amount).toBe("50.00");

      // Invariante Contábil: Total Débitos === Total Créditos
      expect(tx.totalDebits.equals(tx.totalCredits)).toBe(true);
    });
  });

  describe("2. Operação de Prêmio (WIN)", () => {
    it("deve criar uma partida dobrada equilibrada: Débito na Receita da Casa e Crédito na Carteira do Jogador", () => {
      const tx = DoubleEntryTransaction.createWin({
        id: "entry-02",
        transactionId: "tx-win-01",
        walletId,
        providerId,
        money: moneyWin,
      });

      expect(tx.isBalanced()).toBe(true);
      expect(tx.kind).toBe(WagerTransactionKind.Win);
      expect(tx.postings.length).toBe(2);

      const debitPosting = tx.postings.find((p) => p.direction === LedgerDirection.Debit);
      const creditPosting = tx.postings.find((p) => p.direction === LedgerDirection.Credit);

      expect(debitPosting?.accountId).toBe(`HOUSE:REVENUE:${providerId}`);
      expect(debitPosting?.money.amount).toBe("150.00");

      expect(creditPosting?.accountId).toBe(`WALLET:${walletId}`);
      expect(creditPosting?.money.amount).toBe("150.00");

      expect(tx.totalDebits.equals(tx.totalCredits)).toBe(true);
    });
  });

  describe("3. Operação de Estorno (REFUND e ROLLBACK)", () => {
    it("deve criar uma partida dobrada equilibrada no REFUND: Débito no Escrow e Devolução para a Carteira", () => {
      const tx = DoubleEntryTransaction.createRefund({
        id: "entry-03",
        transactionId: "tx-refund-01",
        walletId,
        providerId,
        money: moneyRefund,
        kind: WagerTransactionKind.Refund,
      });

      expect(tx.isBalanced()).toBe(true);
      expect(tx.kind).toBe(WagerTransactionKind.Refund);

      const debitPosting = tx.postings.find((p) => p.direction === LedgerDirection.Debit);
      const creditPosting = tx.postings.find((p) => p.direction === LedgerDirection.Credit);

      expect(debitPosting?.accountId).toBe(`HOUSE:ESCROW:${providerId}`);
      expect(creditPosting?.accountId).toBe(`WALLET:${walletId}`);
      expect(tx.totalDebits.equals(tx.totalCredits)).toBe(true);
    });

    it("deve criar uma partida dobrada equilibrada no ROLLBACK", () => {
      const tx = DoubleEntryTransaction.createRefund({
        id: "entry-04",
        transactionId: "tx-rollback-01",
        walletId,
        providerId,
        money: moneyRefund,
        kind: WagerTransactionKind.Rollback,
      });

      expect(tx.isBalanced()).toBe(true);
      expect(tx.kind).toBe(WagerTransactionKind.Rollback);
      expect(tx.totalDebits.equals(tx.totalCredits)).toBe(true);
    });
  });

  describe("4. Validação de Invariantes Contábeis e Detecção de Falhas", () => {
    it("deve lançar UnbalancedJournalEntryError se a soma de débitos não for estritamente igual à de créditos", () => {
      expect(() => {
        DoubleEntryTransaction.create({
          id: "entry-invalid",
          transactionId: "tx-err",
          kind: WagerTransactionKind.Bet,
          postings: [
            new DoubleEntryPosting({
              accountId: `WALLET:${walletId}`,
              direction: LedgerDirection.Debit,
              money: Money.from({ amount: "50.00", currency: "BRL" }),
            }),
            new DoubleEntryPosting({
              accountId: `HOUSE:ESCROW:${providerId}`,
              direction: LedgerDirection.Credit,
              money: Money.from({ amount: "40.00", currency: "BRL" }), // Desbalanceado em 10.00!
            }),
          ],
        });
      }).toThrow(UnbalancedJournalEntryError);
    });

    it("deve rejeitar transação com moedas divergentes entre os lançamentos", () => {
      expect(() => {
        DoubleEntryTransaction.create({
          id: "entry-curr-err",
          transactionId: "tx-curr-err",
          kind: WagerTransactionKind.Bet,
          postings: [
            new DoubleEntryPosting({
              accountId: `WALLET:${walletId}`,
              direction: LedgerDirection.Debit,
              money: Money.from({ amount: "50.00", currency: "BRL" }),
            }),
            new DoubleEntryPosting({
              accountId: `HOUSE:ESCROW:${providerId}`,
              direction: LedgerDirection.Credit,
              money: Money.from({ amount: "50.00", currency: "USD" }),
            }),
          ],
        });
      }).toThrow(DomainError);
    });

    it("deve rejeitar transação que possua menos de 2 lançamentos (sem contrapartida)", () => {
      expect(() => {
        DoubleEntryTransaction.create({
          id: "entry-single",
          transactionId: "tx-single",
          kind: WagerTransactionKind.Bet,
          postings: [
            new DoubleEntryPosting({
              accountId: `WALLET:${walletId}`,
              direction: LedgerDirection.Debit,
              money: Money.from({ amount: "50.00", currency: "BRL" }),
            }),
          ],
        });
      }).toThrow(DomainError);
    });
  });
});
