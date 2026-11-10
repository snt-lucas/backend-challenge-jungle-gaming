import { describe, expect, it } from "bun:test";
import { OutboxMessage } from "../../../src/domain/entities/outbox-message.entity";

describe("OutboxMessage Entity", () => {
  it("deve enfileirar um novo evento em estado pendente", () => {
    const msg = OutboxMessage.enqueue({
      aggregateId: "agg-123",
      eventType: "WalletBalanceChanged",
      payload: { amount: "50.00" },
    });

    expect(msg.id).toBeDefined();
    expect(msg.aggregateId).toBe("agg-123");
    expect(msg.eventType).toBe("WalletBalanceChanged");
    expect(msg.payload).toEqual({ amount: "50.00" });
    expect(msg.isPending()).toBe(true);
    expect(msg.attempts).toBe(0);
    expect(msg.isDue()).toBe(true);
  });

  it("deve marcar como publicado", () => {
    const msg = OutboxMessage.enqueue({
      aggregateId: "agg-123",
      eventType: "WalletBalanceChanged",
      payload: { amount: "50.00" },
    });

    const publishedAt = new Date();
    msg.markPublished(publishedAt);

    expect(msg.isPending()).toBe(false);
    expect(msg.publishedAt).toEqual(publishedAt);
    expect(msg.isDue()).toBe(false);
  });

  it("deve agendar retry com backoff incremental", () => {
    const msg = OutboxMessage.enqueue({
      aggregateId: "agg-123",
      eventType: "WalletBalanceChanged",
      payload: { amount: "50.00" },
    });

    const now = new Date();
    msg.scheduleRetry(now);

    expect(msg.attempts).toBe(1);
    expect(msg.nextAttemptAt).toBeDefined();
    expect(msg.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});
