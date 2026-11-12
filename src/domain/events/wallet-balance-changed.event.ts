import type { MoneyProps } from "../value-objects/money.vo";
import type { LedgerDirection } from "../enums/ledger-direction.enum";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "./integration-event.base";

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/**
 * Evento disparado estritamente quando o saldo de uma carteira sofrer alteração física.
 */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public override readonly eventType = "WalletBalanceChanged";
  public override readonly version = 1;

  public static create(
    props: IntegrationEventProps<WalletBalanceChangedData>,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged(props);
  }
}
