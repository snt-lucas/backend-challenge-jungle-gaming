import { SQL } from "bun";
import { Logger } from "@nestjs/common";
import { RequestContextService } from "../logging/request-context.service";
import { MetricsService } from "../metrics/metrics.service";

/**
 * Database representation of a persistent transactional outbox message row.
 */
export interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts?: number;
  next_attempt_at?: Date | null;
  published_at?: Date | null;
}

/**
 * Metadata parameters passed to the message publisher for routing and deduplication.
 */
export interface PublishMetadata {
  aggregateId?: string;
  eventId?: string;
}

/**
 * Port contract for publishing outbox events to external message brokers.
 */
export interface MessagePublisher {
  publish(
    eventType: string,
    payload: Record<string, unknown>,
    metadata?: PublishMetadata,
  ): Promise<void>;
}

/**
 * Background worker polling unpublished outbox events using `SELECT ... FOR UPDATE SKIP LOCKED`
 * to guarantee at-least-once external event dispatch without locking contention.
 */
export class OutboxRelayerWorker {
  private readonly logger = new Logger(OutboxRelayerWorker.name);

  constructor(
    private readonly sql: SQL,
    private readonly publisher?: MessagePublisher,
  ) {}

  /**
   * Polls and dispatches a batch of pending outbox events to the message publisher.
   * Updates publication timestamp upon success or calculates exponential backoff retry on failure.
   *
   * @param batchSize - Maximum number of pending events to lock and process (defaults to 10).
   * @returns Array of outbox message rows processed during the batch execution.
   */
  public async processBatch(batchSize: number = 10): Promise<OutboxRow[]> {
    return await this.sql.begin(async (tx) => {
      const messages = (await tx`
        SELECT id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at
        FROM outbox_messages
        WHERE published_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY occurred_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `) as OutboxRow[];

      if (messages.length === 0) {
        return [];
      }

      for (const msg of messages) {
        const lagSeconds = Math.max(
          0,
          (Date.now() - new Date(msg.occurred_at).getTime()) / 1000,
        );
        MetricsService.getInstance().recordOutboxLag(lagSeconds);

        const contextStore = {
          correlationId: msg.aggregate_id,
          transactionId: msg.aggregate_id,
          messageId: msg.id,
        };

        const parsedPayload =
          typeof msg.payload === "string"
            ? JSON.parse(msg.payload)
            : (msg.payload as Record<string, unknown>);

        await RequestContextService.run(contextStore, async () => {
          try {
            if (this.publisher) {
              await this.publisher.publish(msg.event_type, parsedPayload, {
                aggregateId: msg.aggregate_id,
                eventId: msg.id,
              });
            }

            await tx`
              UPDATE outbox_messages
              SET published_at = NOW(), next_attempt_at = NULL
              WHERE id = ${msg.id}
            `;
          } catch (error) {
            MetricsService.getInstance().incrementMessagingRetries();

            this.logger.error(
              `Falha ao publicar evento da outbox [${msg.id}] (${msg.event_type}):`,
              error,
            );

            const currentAttempts = (msg.attempts ?? 0) + 1;
            const backoffSeconds = Math.min(
              Math.pow(2, Math.min(currentAttempts, 8)),
              300,
            );

            await tx`
              UPDATE outbox_messages
              SET 
                attempts = ${currentAttempts},
                next_attempt_at = NOW() + (${backoffSeconds} || ' seconds')::INTERVAL
              WHERE id = ${msg.id}
            `;
          }
        });
      }

      return messages;
    });
  }
}
