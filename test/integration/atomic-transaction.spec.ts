import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { WagerTransactionKind } from "../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/domain/enums/wager-transaction-status.enum";
import { PostgresTestHelper } from "../../src/infrastructure/database/postgres-test-helper";
import { TransactionalWageringProcessorService } from "../../src/infrastructure/services/transactional-wagering-processor.service";

describe("Integração Real PostgreSQL: Atomicidade Transacional e Pessimistic Lock", () => {
  const db = PostgresTestHelper.getInstance();
  let isDbAvailable = false;
  let service: TransactionalWageringProcessorService;

  beforeAll(async () => {
    isDbAvailable = await db.checkAvailability();
    if (isDbAvailable) {
      await db.runMigrations();
      service = new TransactionalWageringProcessorService(db.sql);
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await db.truncateAll();
    }
  });

  it("deve persistir atomicamente na mesma transação: Wallet, Ledger, Inbox e Outbox com SELECT ... FOR UPDATE", async () => {
    if (!isDbAvailable) {
      console.warn(
        "⚠️ [PULADO]: Contêiner PostgreSQL não detectado em localhost:5432. Inicie via: docker compose up -d",
      );
      return;
    }

    const walletId = randomUUID();
    const playerId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${walletId}, ${playerId}, 'BRL', 10000, 1)
    `;

    const input = {
      messageId: "msg-sqs-001",
      consumerName: "wager-sqs-consumer",
      walletId,
      playerId,
      providerId: "evolution-gaming",
      externalTransactionId: "ext-tx-999",
      idempotencyKey: "evolution:ext-tx-999",
      payloadHash: "hash-payload-abc",
      roundId: "round-10",
      gameId: "roulette",
      kind: WagerTransactionKind.Bet,
      amountCents: 4000n, // Débito de 40.00 BRL
      currency: "BRL",
    };

    const result = await service.processWithPessimisticLock(input);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.walletBalanceCents).toBe(6000n);

    const [savedWallet] = await db.sql`
      SELECT balance_cents, version FROM wallets WHERE id = ${walletId}
    `;
    expect(savedWallet.balance_cents).toBe("6000");
    expect(savedWallet.version).toBe(2);

    const [savedLedger] = await db.sql`
      SELECT wallet_id, direction, amount_cents, balance_before_cents, balance_after_cents
      FROM wallet_ledger_entries WHERE id = ${result.ledgerEntryId}
    `;
    expect(savedLedger.wallet_id).toBe(walletId);
    expect(savedLedger.direction).toBe("DEBIT");
    expect(savedLedger.amount_cents).toBe("4000");
    expect(savedLedger.balance_before_cents).toBe("10000");
    expect(savedLedger.balance_after_cents).toBe("6000");

    const [savedInbox] = await db.sql`
      SELECT message_id, consumer_name FROM inbox_messages WHERE message_id = ${input.messageId}
    `;
    expect(savedInbox.message_id).toBe(input.messageId);
    expect(savedInbox.consumer_name).toBe(input.consumerName);

    const [savedOutbox] = await db.sql`
      SELECT aggregate_id, event_type, published_at FROM outbox_messages WHERE id = ${result.outboxMessageId}
    `;
    expect(savedOutbox.aggregate_id).toBe(walletId);
    expect(savedOutbox.event_type).toBe("WagerTransactionProcessed");
    expect(savedOutbox.published_at).toBeNull();
  });

  it("deve executar ROLLBACK completo se ocorrer falha na transação, sem alterar nenhuma das tabelas", async () => {
    if (!isDbAvailable) return;

    const walletId = randomUUID();
    const playerId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${walletId}, ${playerId}, 'BRL', 5000, 1)
    `;

    try {
      await db.sql.begin(async (tx) => {
        await tx`SELECT * FROM wallets WHERE id = ${walletId} FOR UPDATE`;

        await tx`UPDATE wallets SET balance_cents = 2000 WHERE id = ${walletId}`;
        await tx`INSERT INTO inbox_messages (message_id, consumer_name, payload_hash) VALUES ('fail-msg', 'cons', 'h')`;

        throw new Error("Simulated transactional failure before commit");
      });
    } catch {
      // Falha esperada
    }

    const [wallet] =
      await db.sql`SELECT balance_cents FROM wallets WHERE id = ${walletId}`;
    expect(wallet.balance_cents).toBe("5000");

    const inboxCount =
      await db.sql`SELECT count(*) FROM inbox_messages WHERE message_id = 'fail-msg'`;
    expect(inboxCount[0].count).toBe("0");
  });
});
