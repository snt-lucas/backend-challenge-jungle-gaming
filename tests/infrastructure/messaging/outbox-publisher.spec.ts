import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresTestHelper } from "../../../src/infrastructure/database/postgres-test-helper";
import { OutboxSqsPublisher } from "../../../src/infrastructure/messaging/outbox-sqs.publisher";
import {
  OutboxRelayerWorker,
  type OutboxRow,
} from "../../../src/infrastructure/workers/outbox-relayer.worker";

describe("OutboxSqsPublisher e OutboxRelayerWorker — Publicação e Resiliência de Eventos", () => {
  let mockSqsClient: SQSClient;
  let sentSqsCommands: any[];
  let publisher: OutboxSqsPublisher;

  const testQueueUrl =
    "http://localhost:4566/000000000000/wager-transactions.fifo";

  beforeEach(() => {
    sentSqsCommands = [];

    mockSqsClient = {
      send: mock(async (cmd: any) => {
        sentSqsCommands.push(cmd);
        return {};
      }),
    } as unknown as SQSClient;

    publisher = new OutboxSqsPublisher({
      sqsClient: mockSqsClient,
      queueUrl: testQueueUrl,
    });
  });

  describe("OutboxSqsPublisher Adapter", () => {
    it("deve publicar evento no SQS FIFO configurando MessageGroupId e MessageDeduplicationId", async () => {
      const payload = {
        eventId: "event-123",
        aggregateId: "wallet-456",
        eventType: "WalletBalanceChanged",
        data: { amount: "10.00" },
      };

      await publisher.publish("WalletBalanceChanged", payload, {
        aggregateId: "wallet-456",
        eventId: "event-123",
      });

      expect(sentSqsCommands.length).toBe(1);
      const command = sentSqsCommands[0];
      expect(command).toBeInstanceOf(SendMessageCommand);
      expect(command.input.QueueUrl).toBe(testQueueUrl);
      expect(command.input.MessageGroupId).toBe("wallet-456");
      expect(command.input.MessageDeduplicationId).toBe("event-123");
      expect(command.input.MessageAttributes.EventType.StringValue).toBe(
        "WalletBalanceChanged",
      );
      expect(JSON.parse(command.input.MessageBody)).toEqual(payload);
    });
  });

  describe("OutboxRelayerWorker — Processamento em Lote e Retry", () => {
    it("deve varrer batch, publicar no broker e marcar published_at", async () => {
      const rowId = randomUUID();
      const mockRows: OutboxRow[] = [
        {
          id: rowId,
          aggregate_id: "wallet-999",
          event_type: "WagerTransactionProcessed",
          payload: { transactionId: "tx-1", status: "PROCESSED" },
          occurred_at: new Date(),
          attempts: 0,
        },
      ];

      const executedQueries: string[] = [];
      const mockSql: any = {
        begin: async (txCallback: any) => {
          const fakeTx = async (strings: TemplateStringsArray) => {
            const queryText = strings.join(" ");
            executedQueries.push(queryText);
            if (queryText.includes("SELECT")) {
              return mockRows;
            }
            return [];
          };
          return await txCallback(fakeTx);
        },
      };

      const worker = new OutboxRelayerWorker(mockSql, publisher);
      const processed = await worker.processBatch(10);

      expect(processed.length).toBe(1);
      expect(processed[0]?.id).toBe(rowId);

      // Verificou que o publicador SQS foi acionado
      expect(sentSqsCommands.length).toBe(1);
      expect(sentSqsCommands[0].input.MessageGroupId).toBe("wallet-999");
      expect(sentSqsCommands[0].input.MessageDeduplicationId).toBe(rowId);

      // Verificou que UPDATE published_at foi executado
      const updateQuery = executedQueries.find((q) =>
        q.includes("UPDATE outbox_messages"),
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery).toContain("published_at = NOW()");
    });

    it("deve tratar falha no envio agendando retry com incremento de attempts e backoff", async () => {
      const failingPublisher = {
        publish: mock(async () => {
          throw new Error("LocalStack SQS indisponível temporariamente");
        }),
      };

      const rowId = randomUUID();
      const mockRows: OutboxRow[] = [
        {
          id: rowId,
          aggregate_id: "wallet-err",
          event_type: "WagerTransactionRejected",
          payload: { transactionId: "tx-err", failureCode: "INSUFFICIENT_FUNDS" },
          occurred_at: new Date(),
          attempts: 1,
        },
      ];

      const executedQueries: string[] = [];
      const mockSql: any = {
        begin: async (txCallback: any) => {
          const fakeTx = async (strings: TemplateStringsArray) => {
            const queryText = strings.join(" ");
            executedQueries.push(queryText);
            if (queryText.includes("SELECT")) {
              return mockRows;
            }
            return [];
          };
          return await txCallback(fakeTx);
        },
      };

      const worker = new OutboxRelayerWorker(mockSql, failingPublisher);
      const processed = await worker.processBatch(10);

      expect(processed.length).toBe(1);
      expect(failingPublisher.publish).toHaveBeenCalledTimes(1);

      // Verificou que UPDATE next_attempt_at e attempts foi executado (não published_at)
      const updateQuery = executedQueries.find(
        (q) => q.includes("UPDATE outbox_messages") && q.includes("next_attempt_at"),
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery).toContain("attempts =");
      expect(updateQuery).toContain("next_attempt_at = NOW()");
    });

    it("Integração Real PostgreSQL (quando contêiner online): deve filtrar mensagens agendadas para o futuro", async () => {
      const db = PostgresTestHelper.getInstance();
      const isAvailable = await db.checkAvailability();
      if (!isAvailable) {
        console.warn("⚠️ [PULADO]: Contêiner PostgreSQL não detectado.");
        return;
      }

      await db.runMigrations();

      const futureMsgId = randomUUID();
      const eligibleMsgId = randomUUID();

      // Mensagem com next_attempt_at no futuro (não deve ser selecionada)
      await db.sql`
        INSERT INTO outbox_messages (
          id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at
        ) VALUES (
          ${futureMsgId}, 'wallet-future', 'WalletBalanceChanged',
          '{"test":"future"}'::json, NOW(), 2, NOW() + INTERVAL '1 hour'
        )
      `;

      // Mensagem elegível (next_attempt_at nulo)
      await db.sql`
        INSERT INTO outbox_messages (
          id, aggregate_id, event_type, payload, occurred_at, attempts
        ) VALUES (
          ${eligibleMsgId}, 'wallet-eligible', 'WalletBalanceChanged',
          '{"test":"eligible"}'::json, NOW(), 0
        )
      `;

      const worker = new OutboxRelayerWorker(db.sql, publisher);
      const processed = await worker.processBatch(10);

      const processedIds = processed.map((p) => p.id);
      expect(processedIds).toContain(eligibleMsgId);
      expect(processedIds).not.toContain(futureMsgId);

      // Limpeza
      await db.sql`DELETE FROM outbox_messages WHERE id IN (${futureMsgId}, ${eligibleMsgId})`;
    });
  });
});
