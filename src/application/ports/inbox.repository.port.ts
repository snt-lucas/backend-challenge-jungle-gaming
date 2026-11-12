import type { InboxMessage } from "../../domain/entities/inbox-message.entity";

/**
 * Injection token for the InboxRepositoryPort contract.
 */
export const INBOX_REPOSITORY_PORT = Symbol("INBOX_REPOSITORY_PORT");

/**
 * Outbound repository port for persisting and checking inbox deduplication messages.
 */
export interface InboxRepositoryPort {
  exists(consumerName: string, messageId: string): Promise<boolean>;
  save(inboxMessage: InboxMessage): Promise<void>;
}
