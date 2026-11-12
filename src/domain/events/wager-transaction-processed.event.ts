import type { MoneyProps } from "../value-objects/money.vo";
import type { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "../enums/wager-transaction-status.enum";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "./integration-event.base";

export interface WagerTransactionProcessedData {
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
  newBalance: MoneyProps;
  processedAt: string;
}

/**
 * Evento disparado quando uma transação de aposta for processada com sucesso (inclusive LOSS).
 */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  public override readonly eventType = "WagerTransactionProcessed";
  public override readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionProcessedData>,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed(props);
  }
}
