import { EntitySchema } from "@mikro-orm/core";

export interface InboxMessageDbEntity {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export const InboxMessageSchema = new EntitySchema<InboxMessageDbEntity>({
  name: "InboxMessage",
  tableName: "inbox_messages",
  properties: {
    messageId: {
      type: "string",
      primary: true,
      fieldName: "message_id",
      length: 100,
    },
    consumerName: {
      type: "string",
      primary: true,
      fieldName: "consumer_name",
      length: 100,
    },
    payloadHash: { type: "string", fieldName: "payload_hash", length: 64 },
    receivedAt: { type: "Date", fieldName: "received_at", defaultRaw: "NOW()" },
    processedAt: { type: "Date", fieldName: "processed_at", nullable: true },
  },
});
