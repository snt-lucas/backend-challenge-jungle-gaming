import { beforeEach, describe, expect, it } from "bun:test";
import { IdempotencyConflictError } from "../../../src/application/errors/idempotency-conflict.error";
import { WalletNotFoundError } from "../../../src/application/errors/wallet-not-found.error";
import type { WalletLedgerRepositoryPort } from "../../../src/application/ports/wallet-ledger.repository.port";
import type { WalletRepositoryPort } from "../../../src/application/ports/wallet.repository.port";
import type { WagerTransactionRepositoryPort } from "../../../src/application/ports/wager-transaction.repository.port";
import { ProcessWagerTransactionUseCase } from "../../../src/application/use-cases/process-wager-transaction.use-case";
import { Wallet } from "../../../src/domain/entities/wallet.aggregate";
import { WalletLedgerEntry } from "../../../src/domain/entities/wallet-ledger-entry.entity";
import { WagerTransaction } from "../../../src/domain/entities/wager-transaction.entity";
import { FailureCode } from "../../../src/domain/enums/failure-code.enum";
import { LedgerDirection } from "../../../src/domain/enums/ledger-direction.enum";
import { WagerTransactionKind } from "../../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../../src/domain/enums/wager-transaction-status.enum";
import { Money } from "../../../src/domain/value-objects/money.vo";

describe("ProcessWagerTransactionUseCase (Application Layer)", () => {
  // In-memory mock repositories
  let wallets: Map<string, Wallet>;
  let wagerTransactions: Map<string, WagerTransaction>;
  let ledgerEntries: WalletLedgerEntry[];

  let walletRepo: WalletRepositoryPort;
  let wagerTxRepo: WagerTransactionRepositoryPort;
  let ledgerRepo: WalletLedgerRepositoryPort;
  let useCase: ProcessWagerTransactionUseCase;

  const walletId = "wallet-123";
  const playerId = "player-456";
  const providerId = "provider-pragmatic";

  beforeEach(() => {
    wallets = new Map();
    wagerTransactions = new Map();
    ledgerEntries = [];

    walletRepo = {
      findById: async (id: string) => wallets.get(id) ?? null,
      findByPlayerAndCurrency: async (pId: string, cur: string) => {
        for (const w of wallets.values()) {
          if (w.playerId === pId && w.balance.currency === cur) return w;
        }
        return null;
      },
      save: async (wallet: Wallet) => {
        wallets.set(wallet.id, wallet);
      },
    };

    wagerTxRepo = {
      findById: async (id: string) => wagerTransactions.get(id) ?? null,
      findByIdempotencyKey: async (key: string) => {
        for (const tx of wagerTransactions.values()) {
          if (tx.idempotencyKey === key) return tx;
        }
        return null;
      },
      findByProviderAndExternalId: async (provId: string, extId: string) => {
        for (const tx of wagerTransactions.values()) {
          if (tx.providerId === provId && tx.externalTransactionId === extId) {
            return tx;
          }
        }
        return null;
      },
      findByExternalId: async (provId: string, extId: string) => {
        for (const tx of wagerTransactions.values()) {
          if (tx.providerId === provId && tx.externalTransactionId === extId) {
            return tx;
          }
        }
        return null;
      },
      findPendingReferences: async (limit: number) => {
        const result: WagerTransaction[] = [];
        for (const tx of wagerTransactions.values()) {
          if (tx.status === WagerTransactionStatus.PendingReference) {
            result.push(tx);
            if (result.length >= limit) break;
          }
        }
        return result;
      },
      save: async (tx: WagerTransaction) => {
        wagerTransactions.set(tx.id, tx);
      },
    };

    ledgerRepo = {
      save: async (entry: WalletLedgerEntry) => {
        ledgerEntries.push(entry);
      },
      findByWalletId: async (wId: string) => {
        return ledgerEntries.filter((e) => e.walletId === wId);
      },
    };

    useCase = new ProcessWagerTransactionUseCase(
      walletRepo,
      wagerTxRepo,
      ledgerRepo,
    );

    // Inicializa a wallet padrão com 100.00 BRL
    const initialWallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
    wallets.set(walletId, initialWallet);
  });

  describe("Requisito 1: Idempotência Persistente", () => {
    it("deve retornar a resposta salva com idempotentReplay: true quando a mesma requisição for reenviada", async () => {
      const input = {
        idempotencyKey: "prov-pragmatic:bet-101",
        providerId,
        externalTransactionId: "bet-101",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "gates-of-olympus",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      };

      // Primeira execução
      const firstResult = await useCase.execute(input);

      expect(firstResult.status).toBe(WagerTransactionStatus.Processed);
      expect(firstResult.balance.amount).toBe("70.00");
      expect(firstResult.idempotentReplay).toBe(false);
      expect(ledgerEntries.length).toBe(1);

      // Reenvio idêntico
      const replayResult = await useCase.execute(input);

      expect(replayResult.status).toBe(WagerTransactionStatus.Processed);
      expect(replayResult.transactionId).toBe(firstResult.transactionId);
      expect(replayResult.balance.amount).toBe("70.00");
      expect(replayResult.idempotentReplay).toBe(true);

      // Invariante: não duplica movimentação nem ledger
      expect(ledgerEntries.length).toBe(1);
      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("70.00");
      expect(wallet?.version).toBe(2);
    });

    it("deve lançar IdempotencyConflictError (409 Conflict) quando a mesma Idempotency-Key tiver payload diferente", async () => {
      const originalInput = {
        idempotencyKey: "prov-pragmatic:tx-same-key",
        providerId,
        externalTransactionId: "tx-same-key",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "gates-of-olympus",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      };

      await useCase.execute(originalInput);

      const conflictingInput = {
        ...originalInput,
        money: { amount: "50.00", currency: "BRL" }, // Valor diferente para a mesma chave!
      };

      await expect(useCase.execute(conflictingInput)).rejects.toThrow(
        IdempotencyConflictError,
      );

      // Garante que o estado não foi corrompido
      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("70.00");
      expect(ledgerEntries.length).toBe(1);
    });
  });

  describe("Requisito 2: Mensagens Fora de Ordem e Padrão Inbox", () => {
    it("deve persistir REFUND em PENDING_REFERENCE e manter saldo inalterado quando a BET referenciada não existir", async () => {
      const refundInput = {
        idempotencyKey: "prov-pragmatic:refund-999",
        providerId,
        externalTransactionId: "refund-999",
        playerId,
        walletId,
        roundId: "round-88",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Refund,
        money: { amount: "25.00", currency: "BRL" },
        referenceExternalTransactionId: "bet-not-yet-arrived",
      };

      const result = await useCase.execute(refundInput);

      expect(result.status).toBe(WagerTransactionStatus.PendingReference);
      expect(result.idempotentReplay).toBe(false);

      // Saldo da wallet deve permanecer estritamente inalterado (100.00)
      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("100.00");
      expect(wallet?.version).toBe(1);

      // Nenhum ledger pode ter sido gerado
      expect(ledgerEntries.length).toBe(0);

      // A transação foi persistida como PENDING_REFERENCE
      const savedTx = await wagerTxRepo.findById(result.transactionId);
      expect(savedTx?.status).toBe(WagerTransactionStatus.PendingReference);
    });

    it("deve persistir ROLLBACK em PENDING_REFERENCE e manter saldo inalterado quando a transação referenciada não existir", async () => {
      const rollbackInput = {
        idempotencyKey: "prov-pragmatic:rollback-777",
        providerId,
        externalTransactionId: "rollback-777",
        playerId,
        walletId,
        roundId: "round-88",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Rollback,
        money: { amount: "40.00", currency: "BRL" },
        referenceExternalTransactionId: "tx-unborn",
      };

      const result = await useCase.execute(rollbackInput);

      expect(result.status).toBe(WagerTransactionStatus.PendingReference);

      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("100.00");
      expect(ledgerEntries.length).toBe(0);
    });

    it("deve processar REFUND normalmente quando a BET referenciada já tiver chegado e estiver processada", async () => {
      // 1. BET chega e é processada
      const betInput = {
        idempotencyKey: "prov-pragmatic:bet-50",
        providerId,
        externalTransactionId: "bet-50",
        playerId,
        walletId,
        roundId: "round-99",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Bet,
        money: { amount: "50.00", currency: "BRL" },
      };
      await useCase.execute(betInput);

      // Saldo após BET: 50.00
      let wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("50.00");
      expect(ledgerEntries.length).toBe(1);

      // 2. REFUND chega referenciando bet-50
      const refundInput = {
        idempotencyKey: "prov-pragmatic:refund-50",
        providerId,
        externalTransactionId: "refund-50",
        playerId,
        walletId,
        roundId: "round-99",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Refund,
        money: { amount: "50.00", currency: "BRL" },
        referenceExternalTransactionId: "bet-50",
      };
      const refundResult = await useCase.execute(refundInput);

      expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
      expect(refundResult.balance.amount).toBe("100.00");

      // Saldo restaurado para 100.00 e 2 lançamentos no ledger (1 DEBIT da BET + 1 CREDIT do REFUND)
      wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("100.00");
      expect(wallet?.version).toBe(3);
      expect(ledgerEntries.length).toBe(2);
      expect(ledgerEntries[1]!.direction).toBe(LedgerDirection.Credit);
    });
  });

  describe("Requisito 3: Geração Atômica de Ledger por Movimentação Financeira", () => {
    it("deve debitar saldo e gerar exatamente 1 lançamento DEBIT no ledger para BET", async () => {
      const input = {
        idempotencyKey: "prov:bet-1",
        providerId,
        externalTransactionId: "bet-1",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: "BRL" },
      };

      const result = await useCase.execute(input);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(ledgerEntries.length).toBe(1);

      const entry = ledgerEntries[0]!;
      expect(entry.walletId).toBe(walletId);
      expect(entry.transactionId).toBe(result.transactionId);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.amount).toBe("25.00");
      expect(entry.balanceBefore.amount).toBe("100.00");
      expect(entry.balanceAfter.amount).toBe("75.00");
      expect(entry.isBalanced()).toBe(true);
    });

    it("deve creditar saldo e gerar exatamente 1 lançamento CREDIT no ledger para WIN", async () => {
      const input = {
        idempotencyKey: "prov:win-1",
        providerId,
        externalTransactionId: "win-1",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Win,
        money: { amount: "80.00", currency: "BRL" },
      };

      const result = await useCase.execute(input);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(ledgerEntries.length).toBe(1);

      const entry = ledgerEntries[0]!;
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.money.amount).toBe("80.00");
      expect(entry.balanceBefore.amount).toBe("100.00");
      expect(entry.balanceAfter.amount).toBe("180.00");
      expect(entry.isBalanced()).toBe(true);
    });

    it("NÃO deve gerar entrada no ledger nem alterar saldo para transação LOSS", async () => {
      const input = {
        idempotencyKey: "prov:loss-1",
        providerId,
        externalTransactionId: "loss-1",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Loss,
        money: { amount: "0.00", currency: "BRL" },
      };

      const result = await useCase.execute(input);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.amount).toBe("100.00");
      expect(ledgerEntries.length).toBe(0);

      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("100.00");
      expect(wallet?.version).toBe(1);
    });

    it("deve rejeitar BET por saldo insuficiente com failureCode INSUFFICIENT_FUNDS sem gerar ledger", async () => {
      const input = {
        idempotencyKey: "prov:bet-excessive",
        providerId,
        externalTransactionId: "bet-excessive",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        money: { amount: "100.01", currency: "BRL" }, // Saldo é 100.00
      };

      const result = await useCase.execute(input);

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(result.balance.amount).toBe("100.00");
      expect(ledgerEntries.length).toBe(0);

      const wallet = await walletRepo.findById(walletId);
      expect(wallet?.balance.amount).toBe("100.00");
      expect(wallet?.version).toBe(1);
    });

    it("deve propagar erro de moeda distinta ao tentar debitar wallet", async () => {
      const input = {
        idempotencyKey: "prov:bet-currency-mismatch",
        providerId,
        externalTransactionId: "bet-currency-mismatch",
        playerId,
        walletId,
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        money: { amount: "10.00", currency: "USD" }, // Wallet é BRL
      };

      await expect(useCase.execute(input)).rejects.toThrow();
    });

    it("deve lançar WalletNotFoundError se a walletId informada não existir", async () => {
      const input = {
        idempotencyKey: "prov:bet-unknown-wallet",
        providerId,
        externalTransactionId: "bet-unknown",
        playerId,
        walletId: "non-existent-wallet",
        roundId: "round-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        money: { amount: "10.00", currency: "BRL" },
      };

      await expect(useCase.execute(input)).rejects.toThrow(WalletNotFoundError);
    });
  });
});
