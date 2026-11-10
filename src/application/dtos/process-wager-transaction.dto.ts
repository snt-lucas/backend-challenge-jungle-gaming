import { FailureCode } from "../../domain/enums/failure-code.enum";
import { WagerTransactionKind } from "../../domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../domain/enums/wager-transaction-status.enum";

export interface ProcessWagerTransactionInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
  payloadHash?: string;
}

export interface ProcessWagerTransactionOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: {
    amount: string;
    currency: string;
  };
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}
