import { randomUUID } from "node:crypto";
import { WalletLedgerEntry } from "../../domain/entities/wallet-ledger-entry.entity";
import { WagerTransaction } from "../../domain/entities/wager-transaction.entity";
import { FailureCode } from "../../domain/enums/failure-code.enum";
import { LedgerDirection } from "../../domain/enums/ledger-direction.enum";
import { InsufficientFundsError } from "../../domain/errors/insufficient-funds.error";
import { Money } from "../../domain/value-objects/money.vo";
import {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionOutput,
} from "../dtos/process-wager-transaction.dto";
import { IdempotencyConflictError } from "../errors/idempotency-conflict.error";
import { WalletNotFoundError } from "../errors/wallet-not-found.error";
import { WalletLedgerRepositoryPort } from "../ports/wallet-ledger.repository.port";
import { WalletRepositoryPort } from "../ports/wallet.repository.port";
import { WagerTransactionRepositoryPort } from "../ports/wager-transaction.repository.port";
import { computeCanonicalPayloadHash } from "../utils/canonical-json";

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly wagerTxRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
  ) {}

  public async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    // 1. Cálculo de hash canônico dos dados de negócio
    const payloadForHashing = {
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: {
        amount: input.money.amount,
        currency: input.money.currency,
      },
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      roundId: input.roundId,
      walletId: input.walletId,
    };
    const payloadHash =
      input.payloadHash ?? computeCanonicalPayloadHash(payloadForHashing);

    // 2. Verificação de Idempotência Persistente
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

    // 3. Validação da Wallet
    const wallet = await this.walletRepo.findById(input.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    // 4. Criação do Value Object Money e da Entidade WagerTransaction
    const money = Money.from(input.money);
    const wagerTx = WagerTransaction.create({
      id: randomUUID(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    let referencedTx: WagerTransaction | null = null;

    // 5. Suporte ao padrão Inbox e mensagens fora de ordem
    if (wagerTx.requiresReference()) {
      referencedTx = await this.wagerTxRepo.findByProviderAndExternalId(
        input.providerId,
        input.referenceExternalTransactionId!,
      );

      if (!referencedTx) {
        // Referência ainda não recebida: salva como PENDING_REFERENCE sem mover saldo
        wagerTx.markPendingReference();
        await this.wagerTxRepo.save(wagerTx);

        return {
          transactionId: wagerTx.id,
          status: wagerTx.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      }

      // Valida regras de negócio da transação referenciada
      wagerTx.validateReference(referencedTx);
    }

    // 6. Caso a transação não afete saldo (ex: LOSS)
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

    // 7. Processamento financeiro com movimentação de saldo e lançamento no ledger
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

    // Geração atômica de 1 lançamento no ledger
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

    // Persistência das alterações
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
