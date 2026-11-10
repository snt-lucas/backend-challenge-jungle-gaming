import { WagerTransaction } from "../../domain/entities/wager-transaction.entity";

export interface WagerTransactionRepositoryPort {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null>;
  save(transaction: WagerTransaction): Promise<void>;
}
