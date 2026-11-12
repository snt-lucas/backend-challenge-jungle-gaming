import { Inject, Injectable } from "@nestjs/common";
import { WALLET_REPOSITORY_PORT, type WalletRepositoryPort } from "@application/ports/wallet.repository.port";
import { WALLET_LEDGER_REPOSITORY_PORT, type WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger.repository.port";
import { WalletNotFoundError } from "@application/errors";

/**
 * Output DTO for ledger statement queries.
 */
export interface LedgerEntryOutput {
  id: string;
  walletId: string;
  transactionId: string;
  amount: string;
  currency: string;
  direction: string;
  createdAt: Date;
}

/**
 * Use case retrieving paginated audit entries from the wallet's financial ledger.
 */
@Injectable()
export class GetWalletLedgerUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
  ) {}

  /**
   * Retrieves a paginated list of ledger entries for the specified wallet.
   *
   * @param walletId - Unique wallet identifier.
   * @param cursor - Optional timestamp cursor for pagination.
   * @param limit - Maximum number of entries to return (default: 50).
   * @throws {WalletNotFoundError} When wallet does not exist.
   */
  async execute(walletId: string, cursor?: string, limit: number = 50): Promise<LedgerEntryOutput[]> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const entries = await this.ledgerRepository.findByWalletId(walletId, cursor, limit);

    return entries.map((entry) => ({
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      amount: entry.money.amount,
      currency: entry.money.currency,
      direction: entry.direction,
      createdAt: entry.createdAt,
    }));
  }
}
