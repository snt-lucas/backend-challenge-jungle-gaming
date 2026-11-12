import type { MoneyProps } from "../value-objects/money.vo";
import type { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "../enums/wager-transaction-status.enum";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "./integration-event.base";

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  status: WagerTransactionStatus;
  pendingSince: string;
}

/**
 * Evento disparado quando uma operação de reversão (REFUND/ROLLBACK) chega antes da transação referenciada.
 */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public override readonly eventType = "WagerTransactionPendingReference";
  public override readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(props);
  }
}
