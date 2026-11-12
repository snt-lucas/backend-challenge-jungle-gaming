import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "../../application/ports/wager-transaction.repository.port";
import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "../../application/ports/wallet.repository.port";
import {
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "../../application/ports/wallet-ledger.repository.port";
import { WalletLedgerEntry } from "@domain/entities/wallet-ledger-entry.entity";
import { FailureCode } from "@domain/enums/failure-code.enum";
import { LedgerDirection } from "@domain/enums";
import { randomUUID } from "node:crypto";

/**
 * Use case resolving out-of-order transactions stuck in PendingReference status.
 * Reconciles refunds/rollbacks once the parent wager transaction arrives or expires them.
 */
@Injectable()
export class ProcessPendingReferencesUseCase {
  private readonly logger = new Logger(ProcessPendingReferencesUseCase.name);

  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTxRepo: WagerTransactionRepositoryPort,
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepo: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
  ) {}

  /**
   * Scans and resolves pending transactions batch.
   *
   * @param batchLimit - Maximum batch size to inspect.
   * @returns Total count of successfully reconciled transactions.
   */
  async execute(batchLimit: number = 50): Promise<number> {
    const pendingTransactions =
      await this.wagerTxRepo.findPendingReferences(batchLimit);
    let processedCount = 0;

    for (const wagerTx of pendingTransactions) {
      try {
        if (!wagerTx.referenceExternalTransactionId) {
          wagerTx.reject(FailureCode.InvalidReference);
          await this.wagerTxRepo.save(wagerTx);
          continue;
        }

        const referencedTx = await this.wagerTxRepo.findByProviderAndExternalId(
          wagerTx.providerId,
          wagerTx.referenceExternalTransactionId,
        );

        if (!referencedTx) {
          wagerTx.incrementRetryCount();
          if (wagerTx.hasExceededTtlOrMaxRetries()) {
            wagerTx.reject(FailureCode.ReferenceTimeout);
            this.logger.warn(
              `Transação ${wagerTx.id} expirou em PENDING_REFERENCE e foi rejeitada.`,
            );
          }
          await this.wagerTxRepo.save(wagerTx);
          continue;
        }

        wagerTx.validateReference(referencedTx);

        if (!wagerTx.affectsBalance()) {
          wagerTx.markProcessed(referencedTx.id, new Date());
          await this.wagerTxRepo.save(wagerTx);
          processedCount++;
          continue;
        }

        const wallet = await this.walletRepo.findById(wagerTx.walletId);
        if (!wallet) {
          wagerTx.reject(FailureCode.WalletNotFound);
          await this.wagerTxRepo.save(wagerTx);
          continue;
        }

        const direction = wagerTx.ledgerDirectionFor(referencedTx);
        const balanceBefore = wallet.balance;

        if (direction === LedgerDirection.Debit) {
          if (wallet.balance.isLessThan(wagerTx.money)) {
            wagerTx.reject(FailureCode.InsufficientFunds);
            await this.wagerTxRepo.save(wagerTx);
            continue;
          }
          wallet.debit(wagerTx.money);
        } else {
          wallet.credit(wagerTx.money);
        }

        const balanceAfter = wallet.balance;

        const ledgerEntry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId: wagerTx.id,
          direction,
          money: wagerTx.money,
          balanceBefore,
          balanceAfter,
          createdAt: new Date(),
        });

        wagerTx.markProcessed(referencedTx.id, new Date());

        await this.walletRepo.save(wallet);
        await this.ledgerRepo.save(ledgerEntry);
        await this.wagerTxRepo.save(wagerTx);

        processedCount++;
        this.logger.log(
          `Transação pendente ${wagerTx.id} processada com sucesso via referência.`,
        );
      } catch (error) {
        this.logger.error(
          `Erro ao processar transação pendente ${wagerTx.id}:`,
          error,
        );
      }
    }

    return processedCount;
  }
}
