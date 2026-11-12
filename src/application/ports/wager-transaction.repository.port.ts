import type { WagerTransaction } from "../../domain/entities/wager-transaction.entity";

/**
 * Injection token for the WagerTransactionRepositoryPort contract.
 */
export const WAGER_TRANSACTION_REPOSITORY_PORT = Symbol("WAGER_TRANSACTION_REPOSITORY_PORT");

/**
 * Outbound repository port for managing WagerTransaction persistence and idempotency queries.
 */
export interface WagerTransactionRepositoryPort {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null>;
  findByExternalId(providerId: string, externalId: string): Promise<WagerTransaction | null>;
  findPendingReferences(limit: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction): Promise<void>;
}
