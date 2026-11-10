import { describe, expect, it } from "bun:test";
import { InboxMessage } from "../../../src/domain/entities/inbox-message.entity";

describe("InboxMessage Entity", () => {
  it("deve receber uma nova mensagem de inbox não processada", () => {
    const msg = InboxMessage.receive({
      messageId: "msg-123",
      consumerName: "sqs-worker",
      payloadHash: "hash-abc",
    });

    expect(msg.messageId).toBe("msg-123");
    expect(msg.consumerName).toBe("sqs-worker");
    expect(msg.payloadHash).toBe("hash-abc");
    expect(msg.isProcessed()).toBe(false);
    expect(msg.processedAt).toBeUndefined();
  });

  it("deve marcar como processada registrando a data", () => {
    const msg = InboxMessage.receive({
      messageId: "msg-123",
      consumerName: "sqs-worker",
      payloadHash: "hash-abc",
    });

    const now = new Date();
    msg.markProcessed(now);

    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toEqual(now);
  });

  it("deve reidratar estado persistido corretamente", () => {
    const past = new Date("2026-01-01T10:00:00.000Z");
    const processed = new Date("2026-01-01T10:00:05.000Z");

    const msg = InboxMessage.rehydrate({
      messageId: "msg-456",
      consumerName: "sqs-worker",
      payloadHash: "hash-xyz",
      receivedAt: past,
      processedAt: processed,
    });

    expect(msg.isProcessed()).toBe(true);
    expect(msg.receivedAt).toEqual(past);
    expect(msg.processedAt).toEqual(processed);
  });
});
