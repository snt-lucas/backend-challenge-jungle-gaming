import { Inject, Injectable } from "@nestjs/common";
import { WALLET_REPOSITORY_PORT, type WalletRepositoryPort } from "@application/ports/wallet.repository.port";
import { WALLET_LEDGER_REPOSITORY_PORT, type WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger.repository.port";
import { WalletNotFoundError } from "@application/errors";
import { Money } from "@domain/value-objects/money.vo";
import { LedgerDirection } from "@domain/enums";

/**
 * Output DTO for financial ledger reconciliation.
 */
export interface ReconcileWalletOutput {
  walletId: string;
  currentBalance: string;
  ledgerCalculatedBalance: string;
  isConsistent: boolean;
  discrepancy: string;
}

/**
 * Use case verifying financial integrity by calculating the ledger sum against the wallet balance.
 */
@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
  ) {}

  /**
   * Reconciles current wallet balance with the sum of historical credit/debit ledger entries.
   *
   * @param walletId - Unique wallet identifier.
   * @param _referencedTransactions - Optional subset of transactions for selective reconciliation.
   * @throws {WalletNotFoundError} When wallet does not exist.
   */
  async execute(walletId: string, _referencedTransactions?: string[]): Promise<ReconcileWalletOutput> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const ledgerEntries = await this.ledgerRepository.findByWalletId(walletId);
    let calculatedMoney = Money.zero(wallet.balance.currency);

    for (const entry of ledgerEntries) {
      if (entry.direction === LedgerDirection.Credit) {
        calculatedMoney = calculatedMoney.add(entry.money);
      } else if (entry.direction === LedgerDirection.Debit) {
        calculatedMoney = calculatedMoney.subtract(entry.money);
      }
    }

    const currentBalance = wallet.balance;
    const isConsistent = currentBalance.equals(calculatedMoney);

    let discrepancy = "0.00";
    if (!isConsistent) {
      discrepancy = currentBalance.isGreaterThan(calculatedMoney)
        ? currentBalance.subtract(calculatedMoney).amount
        : calculatedMoney.subtract(currentBalance).amount;
    }

    return {
      walletId: wallet.id,
      currentBalance: currentBalance.amount,
      ledgerCalculatedBalance: calculatedMoney.amount,
      isConsistent,
      discrepancy,
    };
  }
}
