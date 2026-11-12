import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransactionRepositoryPort } from "../../../application/ports/wager-transaction.repository.port";
import { WagerTransaction } from "../../../domain/entities/wager-transaction.entity";
import { Money } from "../../../domain/value-objects/money.vo";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/enums";
import {
  WagerTransactionSchema,
  type WagerTransactionDbEntity,
} from "../schemas/wager-transaction.schema";

/**
 * MikroORM-based PostgreSQL implementation of the WagerTransaction repository port.
 */
@Injectable()
export class MikroOrmWagerTransactionRepository
  implements WagerTransactionRepositoryPort
{
  constructor(private readonly em: EntityManager) {}

  /**
   * Finds a wager transaction by its primary key identifier.
   *
   * @param id - Wager transaction primary key UUID.
   * @returns Rehydrated WagerTransaction entity if found, otherwise null.
   */
  async findById(id: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionSchema, { id });
    if (!row) {
      return null;
    }
    return this.mapToDomain(row);
  }

  /**
   * Finds a wager transaction by its provider-scoped idempotency key.
   *
   * @param key - Provider idempotency key.
   * @returns Rehydrated WagerTransaction entity if found, otherwise null.
   */
  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionSchema, {
      idempotencyKey: key,
    });
    if (!row) {
      return null;
    }
    return this.mapToDomain(row);
  }

  /**
   * Finds a wager transaction by provider identifier and external transaction identifier.
   *
   * @param providerId - External provider identifier.
   * @param externalId - External transaction identifier assigned by the provider.
   * @returns Rehydrated WagerTransaction entity if found, otherwise null.
   */
  async findByProviderAndExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionSchema, {
      providerId,
      externalTransactionId: externalId,
    });
    if (!row) {
      return null;
    }
    return this.mapToDomain(row);
  }

  /**
   * Alias for findByProviderAndExternalId meeting repository port contract.
   *
   * @param providerId - External provider identifier.
   * @param externalId - External transaction identifier assigned by the provider.
   * @returns Rehydrated WagerTransaction entity if found, otherwise null.
   */
  async findByExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null> {
    return this.findByProviderAndExternalId(providerId, externalId);
  }

  /**
   * Retrieves transactions currently awaiting parent reference resolution.
   *
   * @param limit - Maximum number of pending transactions to retrieve.
   * @returns Array of transactions in PENDING_REFERENCE status.
   */
  async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const rows = await this.em.find(
      WagerTransactionSchema,
      { status: WagerTransactionStatus.PendingReference },
      { limit, orderBy: { createdAt: "ASC" } },
    );
    return rows.map((row) => this.mapToDomain(row));
  }

  /**
   * Persists or updates a wager transaction record in PostgreSQL.
   *
   * @param transaction - Domain WagerTransaction entity to persist.
   */
  async save(transaction: WagerTransaction): Promise<void> {
    const existing = await this.em.findOne(WagerTransactionSchema, {
      id: transaction.id,
    });

    if (existing) {
      existing.status = transaction.status;
      existing.failureCode = transaction.failureCode;
      existing.referenceTransactionId = transaction.referenceTransactionId;
      existing.processedAt = transaction.processedAt;
      await this.em.flush();
    } else {
      const entity = this.em.create(WagerTransactionSchema, {
        id: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        idempotencyKey: transaction.idempotencyKey,
        payloadHash: transaction.payloadHash,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        amountCents: transaction.money.cents,
        currency: transaction.money.currency,
        status: transaction.status,
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId,
        referenceTransactionId: transaction.referenceTransactionId,
        failureCode: transaction.failureCode,
        createdAt: transaction.createdAt,
        processedAt: transaction.processedAt,
      });
      this.em.persist(entity);
      await this.em.flush();
    }
  }

  /**
   * Maps a database entity row to a domain WagerTransaction entity.
   *
   * @param row - Database entity row.
   * @returns Rehydrated domain WagerTransaction entity.
   */
  private mapToDomain(row: WagerTransactionDbEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      walletId: row.walletId,
      playerId: row.playerId,
      roundId: row.roundId,
      gameId: row.gameId,
      kind: row.kind as WagerTransactionKind,
      money: Money.fromCents(BigInt(row.amountCents), row.currency),
      referenceExternalTransactionId: row.referenceExternalTransactionId,
      referenceTransactionId: row.referenceTransactionId,
      status: row.status as WagerTransactionStatus,
      failureCode: row.failureCode,
      createdAt: new Date(row.createdAt),
      processedAt: row.processedAt ? new Date(row.processedAt) : undefined,
    });
  }
}
