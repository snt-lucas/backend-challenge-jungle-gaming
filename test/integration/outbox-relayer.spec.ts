import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresTestHelper } from "../../src/infrastructure/database/postgres-test-helper";
import { OutboxRelayerWorker } from "../../src/infrastructure/workers/outbox-relayer.worker";

describe("Integração Real PostgreSQL: Worker Outbox Relayer e Concorrência SKIP LOCKED", () => {
  const db = PostgresTestHelper.getInstance();
  let isDbAvailable = false;

  beforeAll(async () => {
    isDbAvailable = await db.checkAvailability();
    if (isDbAvailable) {
      await db.runMigrations();
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await db.truncateAll();
    }
  });

  it("deve processar mensagens da outbox sem duplicidade entre múltiplos workers concorrentes usando SKIP LOCKED", async () => {
    if (!isDbAvailable) {
      console.warn("⚠️ [PULADO]: Contêiner PostgreSQL não detectado.");
      return;
    }

    const totalMessages = 30;
    const insertedIds: string[] = [];

    // 1. Popula a tabela outbox com 30 mensagens pendentes com carimbos sequenciais
    for (let i = 0; i < totalMessages; i++) {
      const id = randomUUID();
      insertedIds.push(id);

      await db.sql`
        INSERT INTO outbox_messages (
          id, aggregate_id, event_type, payload, occurred_at
        ) VALUES (
          ${id},
          ${randomUUID()},
          'WalletBalanceChanged',
          ${JSON.stringify({ index: i, amount: "10.00" })},
          NOW() + (${i} || ' milliseconds')::INTERVAL
        )
      `;
    }

    // 2. Cria 3 instâncias de workers que competem pela mesma tabela
    const processedByWorkerA: string[] = [];
    const processedByWorkerB: string[] = [];
    const processedByWorkerC: string[] = [];

    const workerA = new OutboxRelayerWorker(db.sql, {
      publish: async (_event, payload) => {
        processedByWorkerA.push(payload["index"] as string);
      },
    });

    const workerB = new OutboxRelayerWorker(db.sql, {
      publish: async (_event, payload) => {
        processedByWorkerB.push(payload["index"] as string);
      },
    });

    const workerC = new OutboxRelayerWorker(db.sql, {
      publish: async (_event, payload) => {
        processedByWorkerC.push(payload["index"] as string);
      },
    });

    // 3. Dispara os workers simultaneamente em batches de 5 até esgotar a fila
    const runWorkerLoop = async (worker: OutboxRelayerWorker) => {
      let totalFetched = 0;
      while (true) {
        const batch = await worker.processBatch(5);
        if (batch.length === 0) break;
        totalFetched += batch.length;
      }
      return totalFetched;
    };

    const results = await Promise.all([
      runWorkerLoop(workerA),
      runWorkerLoop(workerB),
      runWorkerLoop(workerC),
    ]);

    const sumProcessed = results.reduce((acc, count) => acc + count, 0);

    // 4. Verificação de garantias concorrentes
    expect(sumProcessed).toBe(totalMessages);

    // Garante que todas as mensagens foram marcadas como publicadas no banco
    const [unprocessedCount] = await db.sql`
      SELECT count(*) FROM outbox_messages WHERE published_at IS NULL
    `;
    expect(unprocessedCount.count).toBe("0");

    // Garante que nenhuma mensagem foi lida/publicada mais de uma vez (zero duplicidade)
    const allPublishedPayloads = [
      ...processedByWorkerA,
      ...processedByWorkerB,
      ...processedByWorkerC,
    ];
    const uniquePublished = new Set(allPublishedPayloads);
    expect(uniquePublished.size).toBe(totalMessages);
  });
});
