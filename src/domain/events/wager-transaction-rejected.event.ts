import type { MoneyProps } from "../value-objects/money.vo";
import type { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "../enums/wager-transaction-status.enum";
import type { FailureCode } from "../enums/failure-code.enum";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "./integration-event.base";

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  status: WagerTransactionStatus;
  failureCode: FailureCode;
  rejectedAt: string;
}

/**
 * Evento disparado quando uma transação de aposta for rejeitada por regras de negócio.
 */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public override readonly eventType = "WagerTransactionRejected";
  public override readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionRejectedData>,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected(props);
  }
}
