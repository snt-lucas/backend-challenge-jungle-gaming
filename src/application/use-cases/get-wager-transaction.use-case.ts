import { Inject, Injectable } from "@nestjs/common";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "../../application/ports/wager-transaction.repository.port";
import { WagerTransactionStatus, WagerTransactionKind } from "@domain/enums";
import { FailureCode } from "@domain/enums/failure-code.enum";

/**
 * Output DTO for wager transaction lookup.
 */
export interface GetWagerTransactionOutput {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId?: string;
  gameId?: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  amount: string;
  currency: string;
  failureCode?: FailureCode;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  processedAt?: Date;
}

/**
 * Use case retrieving wager transaction details by unique transaction identifier.
 */
@Injectable()
export class GetWagerTransactionUseCase {
  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTxRepo: WagerTransactionRepositoryPort,
  ) {}

  /**
   * Retrieves transaction details by ID.
   *
   * @param transactionId - Internal transaction UUID.
   * @throws {Error} When transaction is not found.
   */
  async execute(transactionId: string): Promise<GetWagerTransactionOutput> {
    const transaction = await this.wagerTxRepo.findById(transactionId);

    if (!transaction) {
      throw new Error(
        `Transação de aposta com ID "${transactionId}" não foi encontrada.`,
      );
    }

    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: transaction.status,
      amount: transaction.money.amount,
      currency: transaction.money.currency,
      failureCode: transaction.failureCode,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }
}
