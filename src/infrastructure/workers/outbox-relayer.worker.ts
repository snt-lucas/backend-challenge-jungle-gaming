import { SQL } from "bun";

export interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  published_at?: Date | null;
}

export interface MessagePublisher {
  publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export class OutboxRelayerWorker {
  constructor(
    private readonly sql: SQL,
    private readonly publisher?: MessagePublisher,
  ) {}

  public async processBatch(batchSize: number = 10): Promise<OutboxRow[]> {
    // Processamento atômico com SELECT ... FOR UPDATE SKIP LOCKED
    return await this.sql.begin(async (tx) => {
      const messages = (await tx`
        SELECT id, aggregate_id, event_type, payload, occurred_at
        FROM outbox_messages
        WHERE published_at IS NULL
        ORDER BY occurred_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `) as OutboxRow[];

      if (messages.length === 0) {
        return [];
      }

      for (const msg of messages) {
        if (this.publisher) {
          await this.publisher.publish(msg.event_type, msg.payload);
        }

        await tx`
          UPDATE outbox_messages
          SET published_at = NOW()
          WHERE id = ${msg.id}
        `;
      }

      return messages;
    });
  }
}
