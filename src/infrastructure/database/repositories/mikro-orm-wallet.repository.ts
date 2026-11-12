import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { WalletRepositoryPort } from "../../../application/ports/wallet.repository.port";
import { Wallet } from "../../../domain/entities/wallet.aggregate";
import { Money } from "../../../domain/value-objects/money.vo";
import { WalletSchema, type WalletDbEntity } from "../schemas/wallet.schema";

/**
 * MikroORM-based PostgreSQL implementation of the Wallet repository port.
 */
@Injectable()
export class MikroOrmWalletRepository implements WalletRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  /**
   * Finds a wallet aggregate by its unique identifier.
   *
   * @param id - Wallet aggregate identifier.
   * @returns Rehydrated Wallet aggregate if found, otherwise null.
   */
  async findById(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletSchema, { id });
    if (!row) {
      return null;
    }
    return this.mapToDomain(row);
  }

  /**
   * Finds a wallet aggregate for a given player identifier and currency code.
   *
   * @param playerId - Unique player identifier.
   * @param currency - ISO 4217 three-letter currency code.
   * @returns Rehydrated Wallet aggregate if found, otherwise null.
   */
  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletSchema, {
      playerId,
      currency: currency.trim().toUpperCase(),
    });
    if (!row) {
      return null;
    }
    return this.mapToDomain(row);
  }

  /**
   * Persists or updates a wallet aggregate in PostgreSQL.
   *
   * @param wallet - Wallet aggregate instance to persist.
   */
  async save(wallet: Wallet): Promise<void> {
    const existing = await this.em.findOne(WalletSchema, { id: wallet.id });
    if (existing) {
      existing.balanceCents = wallet.balance.cents;
      existing.version = wallet.version;
      existing.updatedAt = wallet.updatedAt;
      await this.em.flush();
    } else {
      const entity = this.em.create(WalletSchema, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balanceCents: wallet.balance.cents,
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      this.em.persist(entity);
      await this.em.flush();
    }
  }

  /**
   * Maps a database entity row to a domain Wallet aggregate.
   *
   * @param row - Database entity row.
   * @returns Rehydrated domain Wallet aggregate.
   */
  private mapToDomain(row: WalletDbEntity): Wallet {
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.playerId,
      currency: row.currency,
      balance: Money.fromCents(BigInt(row.balanceCents), row.currency),
      version: row.version,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    });
  }
}
