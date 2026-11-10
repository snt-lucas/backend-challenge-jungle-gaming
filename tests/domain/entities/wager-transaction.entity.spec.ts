import { describe, expect, it } from "bun:test";
import { WagerTransaction } from "../../../src/domain/entities/wager-transaction.entity";
import { FailureCode } from "../../../src/domain/enums/failure-code.enum";
import { LedgerDirection } from "../../../src/domain/enums/ledger-direction.enum";
import { WagerTransactionKind } from "../../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../../src/domain/enums/wager-transaction-status.enum";
import { InvalidTransactionOperationError } from "../../../src/domain/errors/invalid-transaction-operation.error";
import { InvalidTransactionStateError } from "../../../src/domain/errors/invalid-transaction-state.error";
import { Money } from "../../../src/domain/value-objects/money.vo";

describe("WagerTransaction Entity", () => {
  const baseProps = {
    id: "tx-001",
    providerId: "provider-evolution",
    externalTransactionId: "ext-100",
    idempotencyKey: "provider-evolution:ext-100",
    payloadHash: "hash-abc-123",
    walletId: "wallet-01",
    playerId: "player-99",
    roundId: "round-777",
    gameId: "lightning-roulette",
    money: Money.from({ amount: "50.00", currency: "BRL" }),
  };

  describe("Criação e Invariantes por Kind", () => {
    it("deve criar uma transação BET em estado PENDING que afeta saldo como DEBIT", () => {
      const bet = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });

      expect(bet.id).toBe("tx-001");
      expect(bet.status).toBe(WagerTransactionStatus.Pending);
      expect(bet.kind).toBe(WagerTransactionKind.Bet);
      expect(bet.affectsBalance()).toBe(true);
      expect(bet.requiresReference()).toBe(false);
      expect(bet.isTerminal()).toBe(false);
      expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it("deve criar uma transação WIN em estado PENDING que afeta saldo como CREDIT", () => {
      const win = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Win,
      });

      expect(win.kind).toBe(WagerTransactionKind.Win);
      expect(win.affectsBalance()).toBe(true);
      expect(win.requiresReference()).toBe(false);
      expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("deve criar uma transação LOSS que NÃO afeta saldo nem gera movimentação no ledger", () => {
      const loss = WagerTransaction.create({
        ...baseProps,
        money: Money.zero("BRL"),
        kind: WagerTransactionKind.Loss,
      });

      expect(loss.kind).toBe(WagerTransactionKind.Loss);
      expect(loss.affectsBalance()).toBe(false);
      expect(loss.requiresReference()).toBe(false);
      expect(() => loss.ledgerDirectionFor()).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("deve criar uma transação OPENING que afeta saldo como CREDIT interno", () => {
      const opening = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Opening,
      });

      expect(opening.kind).toBe(WagerTransactionKind.Opening);
      expect(opening.affectsBalance()).toBe(true);
      expect(opening.requiresReference()).toBe(false);
      expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("deve exigir referenceExternalTransactionId na criação de REFUND", () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
        }),
      ).toThrow(InvalidTransactionOperationError);

      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet-100",
      });

      expect(refund.requiresReference()).toBe(true);
      expect(refund.referenceExternalTransactionId).toBe("ext-bet-100");
      expect(refund.affectsBalance()).toBe(true);
      expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("deve exigir referenceExternalTransactionId na criação de ROLLBACK", () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
        }),
      ).toThrow(InvalidTransactionOperationError);

      const rollback = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-any-100",
      });

      expect(rollback.requiresReference()).toBe(true);
      expect(rollback.referenceExternalTransactionId).toBe("ext-any-100");
    });
  });

  describe("Validação de Referência de Negócio (REFUND & ROLLBACK)", () => {
    const bet = WagerTransaction.create({
      ...baseProps,
      id: "tx-bet",
      externalTransactionId: "ext-bet",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const win = WagerTransaction.create({
      ...baseProps,
      id: "tx-win",
      externalTransactionId: "ext-win",
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: "150.00", currency: "BRL" }),
    });

    const loss = WagerTransaction.create({
      ...baseProps,
      id: "tx-loss",
      externalTransactionId: "ext-loss",
      kind: WagerTransactionKind.Loss,
      money: Money.zero("BRL"),
    });

    it("REFUND deve aceitar apenas transação de referência do tipo BET", () => {
      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });

      expect(() => refund.validateReference(bet)).not.toThrow();

      // REFUND tentando reverter WIN deve falhar
      expect(() => refund.validateReference(win)).toThrow(
        InvalidTransactionOperationError,
      );

      // REFUND tentando reverter LOSS deve falhar
      expect(() => refund.validateReference(loss)).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("ROLLBACK deve aceitar referência de BET, WIN ou REFUND, mas rejeitar LOSS ou ROLLBACK", () => {
      const rollbackBet = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-bet",
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      expect(() => rollbackBet.validateReference(bet)).not.toThrow();

      const rollbackWin = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-win",
        money: Money.from({ amount: "150.00", currency: "BRL" }),
      });
      expect(() => rollbackWin.validateReference(win)).not.toThrow();

      const rollbackLoss = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-loss",
        money: Money.zero("BRL"),
      });
      expect(() => rollbackLoss.validateReference(loss)).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("ROLLBACK deve inverter a direção do lançamento em relação à transação referenciada", () => {
      const rollbackBet = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-bet",
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      // BET é débito -> Rollback de BET é crédito
      expect(rollbackBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);

      const rollbackWin = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-win",
        money: Money.from({ amount: "150.00", currency: "BRL" }),
      });
      // WIN é crédito -> Rollback de WIN é débito
      expect(rollbackWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it("deve rejeitar REFUND ou ROLLBACK com valor divergente do valor da referência (reversão parcial não permitida)", () => {
      const refundMismatch = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
        money: Money.from({ amount: "25.00", currency: "BRL" }), // bet é 50.00
      });

      expect(() => refundMismatch.validateReference(bet)).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("deve rejeitar referência pertencente a round, wallet ou provider distintos", () => {
      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });

      const foreignRoundBet = WagerTransaction.create({
        ...baseProps,
        id: "tx-foreign-round",
        roundId: "another-round",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      expect(() => refund.validateReference(foreignRoundBet)).toThrow(
        InvalidTransactionOperationError,
      );

      const foreignProviderBet = WagerTransaction.create({
        ...baseProps,
        id: "tx-foreign-provider",
        providerId: "another-provider",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      expect(() => refund.validateReference(foreignProviderBet)).toThrow(
        InvalidTransactionOperationError,
      );

      const foreignPlayerBet = WagerTransaction.create({
        ...baseProps,
        id: "tx-foreign-player",
        playerId: "another-player",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      expect(() => refund.validateReference(foreignPlayerBet)).toThrow(
        InvalidTransactionOperationError,
      );

      const foreignWalletBet = WagerTransaction.create({
        ...baseProps,
        id: "tx-foreign-wallet",
        walletId: "another-wallet",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
      });
      expect(() => refund.validateReference(foreignWalletBet)).toThrow(
        InvalidTransactionOperationError,
      );

      const foreignCurrencyBet = WagerTransaction.create({
        ...baseProps,
        id: "tx-foreign-currency",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "50.00", currency: "USD" }),
      });
      expect(() => refund.validateReference(foreignCurrencyBet)).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("ROLLBACK sem referência informada em ledgerDirectionFor deve lançar InvalidTransactionOperationError", () => {
      const rollback = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ext-bet",
      });
      expect(() => rollback.ledgerDirectionFor()).toThrow(
        InvalidTransactionOperationError,
      );
    });

    it("ROLLBACK de REFUND deve gerar DEBIT no ledger", () => {
      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
      });
      const rollbackOfRefund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: refund.externalTransactionId,
      });
      expect(rollbackOfRefund.ledgerDirectionFor(refund)).toBe(
        LedgerDirection.Debit,
      );
    });
  });

  describe("Máquina de Estados e Transições", () => {
    it("deve transicionar de PENDING para PROCESSED com markProcessed()", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });

      const processedDate = new Date();
      tx.markProcessed("ref-internal-123", processedDate);

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe("ref-internal-123");
      expect(tx.processedAt).toEqual(processedDate);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve transicionar de PENDING para PENDING_REFERENCE e posteriormente para PROCESSED", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
      });

      tx.markPendingReference();
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);

      const processedDate = new Date();
      tx.markProcessed("ref-bet-internal", processedDate);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve transicionar para REJECTED com reject(code) e registrar o failureCode", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });

      tx.reject(FailureCode.InsufficientFunds);

      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve transicionar para FAILED com fail(code) e registrar o failureCode", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });

      tx.fail(FailureCode.ConcurrentConflict);

      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.ConcurrentConflict);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve lançar InvalidTransactionStateError ao tentar transicionar transação em estado terminal", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });

      tx.markProcessed(undefined, new Date());
      expect(tx.isTerminal()).toBe(true);

      // Qualquer tentativa de transição subsequente deve ser bloqueada
      expect(() => tx.markProcessed(undefined, new Date())).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.fail(FailureCode.ConcurrentConflict)).toThrow(
        InvalidTransactionStateError,
      );
    });

    it("deve bloquear transições a partir de REJECTED ou FAILED", () => {
      const rejectedTx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });
      rejectedTx.reject(FailureCode.InsufficientFunds);

      expect(() => rejectedTx.markProcessed(undefined, new Date())).toThrow(
        InvalidTransactionStateError,
      );

      const failedTx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });
      failedTx.fail(FailureCode.InvalidPayload);

      expect(() => failedTx.markProcessed(undefined, new Date())).toThrow(
        InvalidTransactionStateError,
      );
    });
  });

  describe("Reidratação e Verificação de Hash", () => {
    it("deve reidratar estado persistido sem disparar validações de transição", () => {
      const pastDate = new Date("2026-06-01T10:00:00.000Z");
      const processedDate = new Date("2026-06-01T10:00:01.000Z");

      const tx = WagerTransaction.rehydrate({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: "ref-999",
        referenceExternalTransactionId: undefined,
        failureCode: undefined,
        createdAt: pastDate,
        processedAt: processedDate,
      });

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe("ref-999");
      expect(tx.processedAt).toEqual(processedDate);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve validar matchesPayload corretamente", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        payloadHash: "expected-hash-123",
        kind: WagerTransactionKind.Bet,
      });

      expect(tx.matchesPayload("expected-hash-123")).toBe(true);
      expect(tx.matchesPayload("different-hash")).toBe(false);
    });
  });
});
