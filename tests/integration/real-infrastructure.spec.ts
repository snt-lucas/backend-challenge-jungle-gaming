import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { TestDatabaseHelper } from "../helpers/test-database.helper";
import { TransactionalWageringProcessorService } from "../../src/infrastructure/services/transactional-wagering-processor.service";
import { OutboxRelayerWorker, type MessagePublisher } from "../../src/infrastructure/workers/outbox-relayer.worker";
import { WagerTransactionKind } from "../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/domain/enums/wager-transaction-status.enum";
import { Money } from "../../src/domain/value-objects/money.vo";

describe("Integração Real PostgreSQL & LocalStack (Infraestrutura Concreta)", () => {
  const db = TestDatabaseHelper.getInstance();
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
      await db.cleanDatabase();
    }
  });

  describe("1. Atomicidade Transacional ACID no PostgreSQL", () => {
    it("deve persistir atomicamente na mesma transação SQL: Wallet, LedgerEntry, InboxMessage e OutboxMessage", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 10000, 1)
      `;

      const input = {
        messageId: "msg-atomic-001",
        consumerName: "wager-transaction-consumer",
        walletId,
        playerId,
        providerId: "pragmatic-play",
        externalTransactionId: "ext-tx-atomic-01",
        idempotencyKey: "pragmatic:ext-tx-atomic-01",
        payloadHash: "hash-canonical-001",
        roundId: "round-1",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Bet,
        amountCents: 4000n, // 40.00 BRL
        currency: "BRL",
      };

      const result = await service.processWithPessimisticLock(input);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.walletBalanceCents).toBe(6000n);

      // Verificação de persistência simultânea de todos os artefatos
      const [walletRow] = await db.sql`SELECT balance_cents, version FROM wallets WHERE id = ${walletId}`;
      expect(walletRow.balance_cents).toBe("6000");
      expect(walletRow.version).toBe(2);

      const [ledgerRow] = await db.sql`
        SELECT direction, amount_cents, balance_before_cents, balance_after_cents 
        FROM wallet_ledger_entries 
        WHERE wallet_id = ${walletId}
      `;
      expect(ledgerRow.direction).toBe("DEBIT");
      expect(ledgerRow.amount_cents).toBe("4000");
      expect(ledgerRow.balance_before_cents).toBe("10000");
      expect(ledgerRow.balance_after_cents).toBe("6000");

      const [inboxRow] = await db.sql`
        SELECT message_id, consumer_name 
        FROM inbox_messages 
        WHERE message_id = ${input.messageId} AND consumer_name = ${input.consumerName}
      `;
      expect(inboxRow).toBeDefined();

      const [outboxRow] = await db.sql`
        SELECT aggregate_id, event_type, published_at 
        FROM outbox_messages 
        WHERE aggregate_id = ${walletId}
      `;
      expect(outboxRow).toBeDefined();
      expect(outboxRow.event_type).toBe("WagerTransactionProcessed");
      expect(outboxRow.published_at).toBeNull();

      // Invariante Contábil Obrigatória
      await db.assertLedgerInvariant(walletId, initialBalance);
    });

    it("deve executar ROLLBACK completo se ocorrer erro na transação, sem alterar nenhuma das tabelas", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 5000, 1)
      `;

      let errorThrown = false;
      try {
        await db.sql.begin(async (tx) => {
          await tx`
            UPDATE wallets
            SET balance_cents = 2000, version = 2
            WHERE id = ${walletId}
          `;

          await tx`
            INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at, processed_at)
            VALUES ('msg-rollback-test', 'test-consumer', 'hash', NOW(), NOW())
          `;

          // Força uma falha intencional antes do commit
          throw new Error("Simulated system crash before commit");
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);

      // Garante que o rollback desfez todas as alterações
      const [walletRow] = await db.sql`SELECT balance_cents, version FROM wallets WHERE id = ${walletId}`;
      expect(walletRow.balance_cents).toBe("5000");
      expect(walletRow.version).toBe(1);

      const [inboxCount] = await db.sql`
        SELECT COUNT(*) as count FROM inbox_messages WHERE message_id = 'msg-rollback-test'
      `;
      expect(inboxCount.count).toBe("0");

      const [ledgerCount] = await db.sql`
        SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(ledgerCount.count).toBe("0");
    });
  });

  describe("2. Violação de Constraints Físicas do Banco", () => {
    it("deve disparar erro da CONSTRAINT check_positive_balance ao tentar saldo negativo direto", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      let errorOccurred = false;
      let constraintName = "";

      try {
        await db.sql`
          INSERT INTO wallets (id, player_id, currency, balance_cents, version)
          VALUES (${randomUUID()}, ${randomUUID()}, 'BRL', -100, 1)
        `;
      } catch (err: any) {
        errorOccurred = true;
        constraintName = err.message || "";
      }

      expect(errorOccurred).toBe(true);
      expect(constraintName.toLowerCase()).toContain("check_positive_balance");
    });

    it("deve disparar erro da CONSTRAINT uk_wallets_player_currency ao tentar duplicar carteira", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const playerId = randomUUID();

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${randomUUID()}, ${playerId}, 'BRL', 1000, 1)
      `;

      let errorOccurred = false;
      let constraintName = "";

      try {
        await db.sql`
          INSERT INTO wallets (id, player_id, currency, balance_cents, version)
          VALUES (${randomUUID()}, ${playerId}, 'BRL', 2000, 1)
        `;
      } catch (err: any) {
        errorOccurred = true;
        constraintName = err.message || "";
      }

      expect(errorOccurred).toBe(true);
      expect(constraintName.toLowerCase()).toContain("uk_wallets_player_currency");
    });

    it("deve disparar erro da CONSTRAINT check_ledger_equation ao violar equação contábil", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const txId = randomUUID();

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 5000, 1)
      `;

      await db.sql`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount_cents, currency, status
        ) VALUES (
          ${txId}, 'prov', 'ext-1', 'idemp-1', 'h', ${walletId}, ${playerId}, 'r', 'g', 'BET', 1000, 'BRL', 'PROCESSED'
        )
      `;

      let errorOccurred = false;
      let constraintName = "";

      try {
        // Débito de 10.00 BRL com balance_before = 50.00 e balance_after = 45.00 (deveria ser 40.00!)
        await db.sql`
          INSERT INTO wallet_ledger_entries (
            id, wallet_id, transaction_id, direction, amount_cents, currency, balance_before_cents, balance_after_cents
          ) VALUES (
            ${randomUUID()}, ${walletId}, ${txId}, 'DEBIT', 1000, 'BRL', 5000, 4500
          )
        `;
      } catch (err: any) {
        errorOccurred = true;
        constraintName = err.message || "";
      }

      expect(errorOccurred).toBe(true);
      expect(constraintName.toLowerCase()).toContain("check_ledger_equation");
    });
  });

  describe("3. Inbox e Redelivery (Crash Recovery Simulado)", () => {
    it("deve barrar reprocessamento via Inbox persistente por (consumerName, messageId) e não duplicar débitos", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 10000, 1)
      `;

      const input = {
        messageId: "msg-crash-001",
        consumerName: "wager-transaction-consumer",
        walletId,
        playerId,
        providerId: "evolution",
        externalTransactionId: "ext-crash-01",
        idempotencyKey: "evolution:ext-crash-01",
        payloadHash: "hash-crash-01",
        roundId: "round-crash",
        gameId: "lightning-roulette",
        kind: WagerTransactionKind.Bet,
        amountCents: 3000n, // 30.00 BRL
        currency: "BRL",
      };

      // 1ª Execução com sucesso
      const firstResult = await service.processWithPessimisticLock(input);
      expect(firstResult.status).toBe(WagerTransactionStatus.Processed);

      // Simulação do crash antes do ACK: SQS reenfileira a mesma mensagem
      // O consumidor consulta o Inbox no PostgreSQL
      const [existingInbox] = await db.sql`
        SELECT message_id, consumer_name 
        FROM inbox_messages 
        WHERE consumer_name = ${input.consumerName} AND message_id = ${input.messageId}
      `;
      expect(existingInbox).toBeDefined();

      // Tentativa de duplicar o mesmo registro no inbox deve falhar na PRIMARY KEY
      let duplicateInboxBlocked = false;
      try {
        await db.sql`
          INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at, processed_at)
          VALUES (${input.messageId}, ${input.consumerName}, ${input.payloadHash}, NOW(), NOW())
        `;
      } catch (err: any) {
        duplicateInboxBlocked = true;
      }
      expect(duplicateInboxBlocked).toBe(true);

      // Comprova que o Ledger contém rigorosamente 1 lançamento de débito
      const [ledgerCount] = await db.sql`
        SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(ledgerCount.count).toBe("1");

      const [walletRow] = await db.sql`SELECT balance_cents FROM wallets WHERE id = ${walletId}`;
      expect(walletRow.balance_cents).toBe("7000"); // 100.00 - 30.00 = 70.00 BRL

      // Invariante Contábil Obrigatória
      await db.assertLedgerInvariant(walletId, initialBalance);
    });
  });

  describe("4. Outbox Relayer com Múltiplos Publishers (SKIP LOCKED)", () => {
    it("deve processar exatamente 20 eventos pendentes sem duplicidade entre 2 workers concorrentes usando SKIP LOCKED", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const totalEvents = 20;
      const publishedEvents = new Set<string>();

      const mockPublisher: MessagePublisher = {
        publish: async (_eventType, _payload, metadata) => {
          if (metadata?.eventId) {
            if (publishedEvents.has(metadata.eventId)) {
              throw new Error(`Colisão detectada: evento ${metadata.eventId} publicado em duplicidade!`);
            }
            publishedEvents.add(metadata.eventId);
          }
        },
      };

      // Insere 20 eventos não publicados na outbox_messages
      for (let i = 0; i < totalEvents; i++) {
        const eventId = randomUUID();
        const aggregateId = randomUUID();
        await db.sql`
          INSERT INTO outbox_messages (
            id, aggregate_id, event_type, payload, occurred_at, published_at
          ) VALUES (
            ${eventId}, ${aggregateId}, 'WagerTransactionProcessed',
            ${JSON.stringify({ index: i, aggregateId })}, NOW(), NULL
          )
        `;
      }

      const worker1 = new OutboxRelayerWorker(db.sql, mockPublisher);
      const worker2 = new OutboxRelayerWorker(db.sql, mockPublisher);

      // Dispara 2 workers simultâneos buscando lotes de 10 com SKIP LOCKED
      await Promise.all([
        worker1.processBatch(10),
        worker2.processBatch(10),
      ]);

      // Executa nova rodada caso sobrem itens no lote
      await Promise.all([
        worker1.processBatch(10),
        worker2.processBatch(10),
      ]);

      // Todos os 20 eventos devem ter sido publicados sem duplicidade
      expect(publishedEvents.size).toBe(totalEvents);

      const [pendingCount] = await db.sql`
        SELECT COUNT(*) as count FROM outbox_messages WHERE published_at IS NULL
      `;
      expect(pendingCount.count).toBe("0");

      const [publishedCount] = await db.sql`
        SELECT COUNT(*) as count FROM outbox_messages WHERE published_at IS NOT NULL
      `;
      expect(publishedCount.count).toBe(totalEvents.toString());
    });
  });
});
