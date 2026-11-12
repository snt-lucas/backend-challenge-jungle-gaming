import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { InboxRepositoryPort } from "../../../application/ports/inbox.repository.port";
import { InboxMessage } from "../../../domain/entities/inbox-message.entity";
import { InboxMessageSchema } from "../schemas/inbox-message.schema";

/**
 * MikroORM-based PostgreSQL implementation of the InboxRepository port
 * guaranteeing consumer deduplication and exactly-once processing semantics.
 */
@Injectable()
export class MikroOrmInboxRepository implements InboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  /**
   * Checks whether a message has already been received or processed by the named consumer.
   *
   * @param consumerName - Logical consumer identifier.
   * @param messageId - Broker-assigned message identifier.
   * @returns True if entry already exists in the inbox table.
   */
  async exists(consumerName: string, messageId: string): Promise<boolean> {
    const count = await this.em.count(InboxMessageSchema, {
      consumerName,
      messageId,
    });
    return count > 0;
  }

  /**
   * Persists a new inbox message or updates its processing timestamp upon completion.
   *
   * @param inboxMessage - Domain InboxMessage entity.
   */
  async save(inboxMessage: InboxMessage): Promise<void> {
    const existing = await this.em.findOne(InboxMessageSchema, {
      consumerName: inboxMessage.consumerName,
      messageId: inboxMessage.messageId,
    });

    if (existing) {
      if (inboxMessage.processedAt) {
        existing.processedAt = inboxMessage.processedAt;
        await this.em.flush();
      }
    } else {
      const entity = this.em.create(InboxMessageSchema, {
        messageId: inboxMessage.messageId,
        consumerName: inboxMessage.consumerName,
        payloadHash: inboxMessage.payloadHash,
        receivedAt: inboxMessage.receivedAt,
        processedAt: inboxMessage.processedAt,
      });
      this.em.persist(entity);
      await this.em.flush();
    }
  }
}
