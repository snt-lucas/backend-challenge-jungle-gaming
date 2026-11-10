import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { FailureCode } from "../../src/domain/enums/failure-code.enum";
import { WagerTransactionStatus } from "../../src/domain/enums/wager-transaction-status.enum";
import { PostgresTestHelper } from "../../src/infrastructure/database/postgres-test-helper";
import { PendingReferenceTtlWorker } from "../../src/infrastructure/workers/pending-reference-ttl.worker";

describe("Integração Real PostgreSQL: Resiliência de PENDING_REFERENCE e TTL Expirado", () => {
  const db = PostgresTestHelper.getInstance();
  let isDbAvailable = false;
  let worker: PendingReferenceTtlWorker;

  beforeAll(async () => {
    isDbAvailable = await db.checkAvailability();
    if (isDbAvailable) {
      await db.runMigrations();
      worker = new PendingReferenceTtlWorker(db.sql);
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await db.truncateAll();
    }
  });

  it("deve transicionar mensagens PENDING_REFERENCE expiradas para REJECTED e emitir WagerTransactionRejected na outbox", async () => {
    if (!isDbAvailable) {
      console.warn("⚠️ [PULADO]: Contêiner PostgreSQL não detectado.");
      return;
    }

    const walletId = randomUUID();
    const playerId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${walletId}, ${playerId}, 'BRL', 5000, 1)
    `;

    const expiredTxId = randomUUID();
    const activeTxId = randomUUID();

    // 1. Cria transação expirada (criada há 120 segundos, TTL é 30s)
    await db.sql`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount_cents, currency,
        status, reference_external_transaction_id, created_at
      ) VALUES (
        ${expiredTxId}, 'pragmatic', 'refund-expired', 'idemp-expired', 'hash-1',
        ${walletId}, ${playerId}, 'round-1', 'game-1', 'REFUND', 2000, 'BRL',
        ${WagerTransactionStatus.PendingReference}, 'bet-never-arrived',
        NOW() - INTERVAL '120 seconds'
      )
    `;

    // 2. Cria transação recente (ainda dentro da janela de TTL)
    await db.sql`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount_cents, currency,
        status, reference_external_transaction_id, created_at
      ) VALUES (
        ${activeTxId}, 'pragmatic', 'refund-active', 'idemp-active', 'hash-2',
        ${walletId}, ${playerId}, 'round-2', 'game-1', 'REFUND', 1000, 'BRL',
        ${WagerTransactionStatus.PendingReference}, 'bet-recent',
        NOW()
      )
    `;

    // 3. Executa o worker com TTL de 30 segundos
    const processed = await worker.processExpired(30);

    expect(processed.length).toBe(1);
    expect(processed[0]!.id).toBe(expiredTxId);

    // 4. Valida que a transação expirada foi marcada como REJECTED
    const [savedExpiredTx] = await db.sql`
      SELECT status, failure_code, processed_at
      FROM wager_transactions
      WHERE id = ${expiredTxId}
    `;
    expect(savedExpiredTx.status).toBe(WagerTransactionStatus.Rejected);
    expect(savedExpiredTx.failure_code).toBe(FailureCode.ReferenceNotFound);
    expect(savedExpiredTx.processed_at).not.toBeNull();

    // 5. Valida que a transação ativa permaneceu em PENDING_REFERENCE
    const [savedActiveTx] = await db.sql`
      SELECT status, failure_code
      FROM wager_transactions
      WHERE id = ${activeTxId}
    `;
    expect(savedActiveTx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(savedActiveTx.failure_code).toBeNull();

    // 6. Valida que o evento WagerTransactionRejected foi gravado atomicamente na outbox
    const [outboxEvent] = await db.sql`
      SELECT aggregate_id, event_type, payload
      FROM outbox_messages
      WHERE aggregate_id = ${expiredTxId}
    `;
    expect(outboxEvent).toBeDefined();
    expect(outboxEvent.event_type).toBe("WagerTransactionRejected");
    expect(outboxEvent.payload.failureCode).toBe(FailureCode.ReferenceNotFound);
  });
});
