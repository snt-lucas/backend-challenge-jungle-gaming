import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { WalletLedgerRepositoryPort } from "../../../application/ports/wallet-ledger.repository.port";
import { WalletLedgerEntry } from "../../../domain/entities/wallet-ledger-entry.entity";
import { LedgerDirection } from "../../../domain/enums";
import { Money } from "../../../domain/value-objects/money.vo";
import {
  WalletLedgerEntrySchema,
  type WalletLedgerEntryDbEntity,
} from "../schemas/wallet-ledger-entry.schema";

/**
 * MikroORM-based PostgreSQL implementation of the WalletLedger repository port.
 */
@Injectable()
export class MikroOrmWalletLedgerRepository
  implements WalletLedgerRepositoryPort
{
  constructor(private readonly em: EntityManager) {}

  /**
   * Persists an immutable ledger entry recording a balance mutation.
   *
   * @param entry - WalletLedgerEntry instance to persist.
   */
  async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = this.em.create(WalletLedgerEntrySchema, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amountCents: entry.money.cents,
      currency: entry.money.currency,
      balanceBeforeCents: entry.balanceBefore.cents,
      balanceAfterCents: entry.balanceAfter.cents,
      createdAt: entry.createdAt,
    });
    this.em.persist(entity);
    await this.em.flush();
  }

  /**
   * Retrieves paginated ledger records for a specified wallet in reverse chronological order.
   *
   * @param walletId - Unique wallet aggregate identifier.
   * @param cursor - ISO timestamp cursor for pagination.
   * @param limit - Maximum number of entries to return (defaults to 50).
   * @returns Array of rehydrated WalletLedgerEntry entities.
   */
  async findByWalletId(
    walletId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<WalletLedgerEntry[]> {
    const where: any = { walletId };
    if (cursor) {
      where.createdAt = { $lt: new Date(cursor) };
    }

    const rows = await this.em.find(WalletLedgerEntrySchema, where, {
      limit,
      orderBy: { createdAt: "DESC" },
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  /**
   * Maps a database entity row to a domain WalletLedgerEntry entity.
   *
   * @param row - Database entity row.
   * @returns Rehydrated domain WalletLedgerEntry entity.
   */
  private mapToDomain(row: WalletLedgerEntryDbEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.walletId,
      transactionId: row.transactionId,
      direction: row.direction as LedgerDirection,
      money: Money.fromCents(BigInt(row.amountCents), row.currency),
      balanceBefore: Money.fromCents(
        BigInt(row.balanceBeforeCents),
        row.currency,
      ),
      balanceAfter: Money.fromCents(
        BigInt(row.balanceAfterCents),
        row.currency,
      ),
      createdAt: new Date(row.createdAt),
    });
  }
}
