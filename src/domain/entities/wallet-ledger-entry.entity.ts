import { LedgerDirection } from "../enums/ledger-direction.enum";
import { InvalidMoneyError } from "../errors/invalid-money.error";
import { Money } from "../value-objects/money.vo";

/**
 * Properties required to create an immutable WalletLedgerEntry.
 */
export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

/**
 * Snapshot state for rehydrating a WalletLedgerEntry from database records.
 */
export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/**
 * Immutable financial ledger entry representing an audit record of a wallet balance mutation.
 * Guarantees mathematical equation balance: balanceBefore ± money === balanceAfter.
 */
export class WalletLedgerEntry {
  protected constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  /**
   * Factory creating a validated, immutable ledger entry.
   *
   * @param props - Entry attributes and balance checkpoints.
   * @returns Balanced WalletLedgerEntry instance.
   * @throws {InvalidMoneyError} When balance before and after do not satisfy the accounting equation.
   */
  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new InvalidMoneyError(
        `Ledger entry is not balanced: balanceBefore (${props.balanceBefore.amount}) ` +
          `${props.direction === LedgerDirection.Debit ? "-" : "+"} ` +
          `money (${props.money.amount}) does not equal balanceAfter (${props.balanceAfter.amount})`,
      );
    }

    return entry;
  }

  /**
   * Rehydrates a ledger entry from database persistence.
   */
  public static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Verifies if the ledger entry satisfies the fundamental accounting equation.
   */
  public isBalanced(): boolean {
    if (this.direction === LedgerDirection.Debit) {
      return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
    } else {
      return this.balanceBefore.add(this.money).equals(this.balanceAfter);
    }
  }
}
