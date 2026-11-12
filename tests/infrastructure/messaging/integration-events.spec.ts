import { describe, expect, it } from "bun:test";
import {
  FailureCode,
  LedgerDirection,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../src/domain/enums";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../../src/domain/events";

describe("Hierarquia de Eventos de Integração e Serialização de Envelopes", () => {
  const fixedDate = new Date("2026-11-10T12:00:00.000Z");

  it("deve criar e serializar WagerTransactionProcessed com envelope estável e MoneyProps", () => {
    const event = WagerTransactionProcessed.create({
      eventId: "event-tx-001",
      aggregateId: "wallet-100",
      correlationId: "corr-100",
      causationId: "msg-100",
      occurredAt: fixedDate,
      data: {
        transactionId: "tx-100",
        walletId: "wallet-100",
        playerId: "player-1",
        providerId: "pragmatic",
        externalTransactionId: "ext-100",
        roundId: "round-1",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: "BRL" },
        status: WagerTransactionStatus.Processed,
        newBalance: { amount: "975.00", currency: "BRL" },
        processedAt: fixedDate.toISOString(),
      },
    });

    expect(event.eventType).toBe("WagerTransactionProcessed");
    expect(event.version).toBe(1);
    expect(event.eventId).toBe("event-tx-001");
    expect(event.aggregateId).toBe("wallet-100");
    expect(Object.isFrozen(event.data)).toBe(true);

    const json = event.toJSON();
    expect(json.eventType).toBe("WagerTransactionProcessed");
    expect(json.version).toBe(1);
    expect(json.occurredAt).toBe("2026-11-10T12:00:00.000Z");
    expect(json.data.money).toEqual({ amount: "25.00", currency: "BRL" });
    expect(json.data.newBalance).toEqual({ amount: "975.00", currency: "BRL" });
    expect(typeof json.data.money.amount).toBe("string");
  });

  it("deve criar e serializar WagerTransactionRejected com failureCode e MoneyProps", () => {
    const event = WagerTransactionRejected.create({
      aggregateId: "wallet-100",
      data: {
        transactionId: "tx-rej-001",
        walletId: "wallet-100",
        playerId: "player-1",
        providerId: "pragmatic",
        externalTransactionId: "ext-rej-100",
        roundId: "round-1",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Bet,
        money: { amount: "5000.00", currency: "BRL" },
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.InsufficientFunds,
        rejectedAt: fixedDate.toISOString(),
      },
    });

    expect(event.eventType).toBe("WagerTransactionRejected");
    expect(event.version).toBe(1);
    expect(event.eventId).toBeDefined();
    expect(event.correlationId).toBe(event.eventId);

    const json = event.toJSON();
    expect(json.data.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(json.data.money).toEqual({ amount: "5000.00", currency: "BRL" });
  });

  it("deve criar e serializar WalletBalanceChanged estritamente com MoneyProps e LedgerDirection", () => {
    const event = WalletBalanceChanged.create({
      eventId: "event-bal-001",
      aggregateId: "wallet-100",
      occurredAt: fixedDate,
      data: {
        walletId: "wallet-100",
        transactionId: "tx-100",
        direction: LedgerDirection.Debit,
        money: { amount: "50.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "50.00", currency: "BRL" },
        walletVersion: 2,
      },
    });

    expect(event.eventType).toBe("WalletBalanceChanged");
    expect(event.version).toBe(1);

    const json = event.toJSON();
    expect(json.data.direction).toBe(LedgerDirection.Debit);
    expect(json.data.walletVersion).toBe(2);
    expect(json.data.money).toEqual({ amount: "50.00", currency: "BRL" });
    expect(json.data.balanceBefore).toEqual({ amount: "100.00", currency: "BRL" });
    expect(json.data.balanceAfter).toEqual({ amount: "50.00", currency: "BRL" });
    expect(json.occurredAt).toBe("2026-11-10T12:00:00.000Z");
  });

  it("deve criar e serializar WagerTransactionPendingReference quando a referência estiver ausente", () => {
    const event = WagerTransactionPendingReference.create({
      aggregateId: "wallet-100",
      data: {
        transactionId: "tx-pending-001",
        walletId: "wallet-100",
        playerId: "player-1",
        providerId: "pragmatic",
        externalTransactionId: "ext-refund-1",
        referenceExternalTransactionId: "ext-bet-missing",
        roundId: "round-1",
        gameId: "gates-of-olympus",
        kind: WagerTransactionKind.Refund,
        money: { amount: "20.00", currency: "BRL" },
        status: WagerTransactionStatus.PendingReference,
        pendingSince: fixedDate.toISOString(),
      },
    });

    expect(event.eventType).toBe("WagerTransactionPendingReference");
    expect(event.version).toBe(1);

    const json = event.toJSON();
    expect(json.data.kind).toBe(WagerTransactionKind.Refund);
    expect(json.data.referenceExternalTransactionId).toBe("ext-bet-missing");
    expect(json.data.status).toBe(WagerTransactionStatus.PendingReference);
  });
});
