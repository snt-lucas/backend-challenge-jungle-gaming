import { EntitySchema } from "@mikro-orm/core";

export interface OutboxMessageDbEntity {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export const OutboxMessageSchema = new EntitySchema<OutboxMessageDbEntity>({
  name: "OutboxMessage",
  tableName: "outbox_messages",
  properties: {
    id: { type: "string", primary: true, length: 36 },
    aggregateId: { type: "string", fieldName: "aggregate_id", length: 36 },
    eventType: { type: "string", fieldName: "event_type", length: 100 },
    payload: { type: "json" },
    occurredAt: {
      type: "Date",
      fieldName: "occurred_at",
      defaultRaw: "NOW()",
    },
    attempts: { type: "number", default: 0 },
    nextAttemptAt: {
      type: "Date",
      fieldName: "next_attempt_at",
      nullable: true,
    },
    publishedAt: {
      type: "Date",
      fieldName: "published_at",
      nullable: true,
    },
  },
  indexes: [
    {
      properties: ["occurredAt"],
      name: "idx_outbox_pending_skip_locked",
    },
  ],
});
