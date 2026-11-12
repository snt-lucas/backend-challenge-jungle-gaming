import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { WalletLedgerEntry } from "../../domain/entities/wallet-ledger-entry.entity";
import { WagerTransaction } from "../../domain/entities/wager-transaction.entity";
import { FailureCode } from "../../domain/enums/failure-code.enum";
import { LedgerDirection } from "../../domain/enums/ledger-direction.enum";
import { InsufficientFundsError } from "../../domain/errors/insufficient-funds.error";
import { Money } from "../../domain/value-objects/money.vo";
import type {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionOutput,
} from "../dtos/process-wager-transaction.dto";
import { IdempotencyConflictError } from "../errors/idempotency-conflict.error";
import { WalletNotFoundError } from "../errors/wallet-not-found.error";
import {
  PESSIMISTIC_LOCK_PORT,
  type PessimisticLockPort,
} from "../ports/pessimistic-lock.port";
import {
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "../ports/wallet-ledger.repository.port";
import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "../ports/wallet.repository.port";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "../ports/wager-transaction.repository.port";
import { computeCanonicalPayloadHash } from "../utils/canonical-json";

/**
 * Application use case orchestrating wager transaction processing.
 * Enforces persistent idempotency, pessimistic locking, ledger entry creation,
 * and out-of-order reference handling.
 */
@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepo: WalletRepositoryPort,
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTxRepo: WagerTransactionRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
    @Optional()
    @Inject(PESSIMISTIC_LOCK_PORT)
    private readonly lockPort?: PessimisticLockPort,
  ) {}

  /**
   * Executes wager processing within an optional pessimistic lock boundary.
   *
   * @param input - Transaction request parameters and canonical payload hash.
   * @returns Processing result with current wallet balance and status.
   * @throws {IdempotencyConflictError} When key was reused with conflicting payload.
   * @throws {WalletNotFoundError} When specified wallet does not exist.
   */
  public async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    if (this.lockPort) {
      return await this.lockPort.acquire(input.walletId, () =>
        this.processTransaction(input),
      );
    }
    return await this.processTransaction(input);
  }

  private async processTransaction(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    const amount = input.money?.amount ?? input.amount!;
    const currency = input.money?.currency ?? input.currency!;
    const playerId = input.playerId ?? input.wagererId ?? "";
    const roundId = input.roundId ?? "";
    const gameId = input.gameId ?? "";

    const payloadForHashing = {
      externalTransactionId: input.externalTransactionId,
      gameId,
      kind: input.kind,
      money: {
        amount,
        currency,
      },
      playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      roundId,
      walletId: input.walletId,
    };
    const payloadHash =
      input.payloadHash ?? computeCanonicalPayloadHash(payloadForHashing);

    const existingTx = await this.wagerTxRepo.findByIdempotencyKey(
      input.idempotencyKey,
    );

    if (existingTx) {
      if (!existingTx.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(
          `Idempotency conflict: key "${input.idempotencyKey}" was already used with a different payload`,
        );
      }

      const wallet = await this.walletRepo.findById(existingTx.walletId);
      return {
        transactionId: existingTx.id,
        status: existingTx.status,
        balance: wallet ? wallet.balance.toJSON() : existingTx.money.toJSON(),
        idempotentReplay: true,
        failureCode: existingTx.failureCode,
      };
    }

    const wallet = await this.walletRepo.findById(input.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    const money = input.money
      ? Money.from(input.money)
      : Money.from({ amount, currency });
    const wagerTx = WagerTransaction.create({
      id: randomUUID(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId,
      roundId,
      gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    let referencedTx: WagerTransaction | null = null;

    if (wagerTx.requiresReference()) {
      referencedTx = await this.wagerTxRepo.findByProviderAndExternalId(
        input.providerId,
        input.referenceExternalTransactionId!,
      );

      if (!referencedTx) {
        wagerTx.markPendingReference();
        await this.wagerTxRepo.save(wagerTx);

        return {
          transactionId: wagerTx.id,
          status: wagerTx.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      }

      wagerTx.validateReference(referencedTx);
    }

    if (!wagerTx.affectsBalance()) {
      wagerTx.markProcessed(referencedTx?.id, new Date());
      await this.wagerTxRepo.save(wagerTx);

      return {
        transactionId: wagerTx.id,
        status: wagerTx.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    const direction = wagerTx.ledgerDirectionFor(referencedTx ?? undefined);
    const balanceBefore = wallet.balance;

    if (direction === LedgerDirection.Debit) {
      try {
        wallet.debit(wagerTx.money);
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          wagerTx.reject(FailureCode.InsufficientFunds);
          await this.wagerTxRepo.save(wagerTx);

          return {
            transactionId: wagerTx.id,
            status: wagerTx.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
            failureCode: FailureCode.InsufficientFunds,
          };
        }
        throw err;
      }
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

    wagerTx.markProcessed(referencedTx?.id, new Date());

    await this.walletRepo.save(wallet);
    await this.ledgerRepo.save(ledgerEntry);
    await this.wagerTxRepo.save(wagerTx);

    return {
      transactionId: wagerTx.id,
      status: wagerTx.status,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }
}
