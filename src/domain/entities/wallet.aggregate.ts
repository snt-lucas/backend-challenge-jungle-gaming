import { CurrencyMismatchError } from "../errors/currency-mismatch.error";
import { InsufficientFundsError } from "../errors/insufficient-funds.error";
import { InvalidMoneyError } from "../errors/invalid-money.error";
import { Money } from "../value-objects/money.vo";

/**
 * Properties required to initialize and open a new Wallet aggregate.
 */
export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance?: Money;
  currency?: string;
}

/**
 * Complete internal state representation of a Wallet used for persistence rehydration.
 */
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate root representing a player's financial wallet for a specific ISO-4217 currency.
 * Enforces non-negative balance invariants and optimistic concurrency versioning.
 */
export class Wallet {
  protected constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {
    this.assertSameCurrency(this._balance);
  }

  /**
   * Opens and instantiates a new player Wallet aggregate with version 1.
   *
   * @param props - Initialization payload containing identifiers and optional initial balance.
   * @returns Newly instantiated Wallet aggregate root.
   * @throws {Error} When id or playerId is missing.
   * @throws {CurrencyMismatchError} When initialBalance currency differs from currency param.
   * @throws {InvalidMoneyError} When initial balance is negative.
   */
  public static open(props: OpenWalletProps): Wallet {
    if (!props.id || !props.playerId) {
      throw new Error("Wallet requires valid id and playerId");
    }

    let initialBalance: Money;
    let currency: string;

    if (props.initialBalance) {
      initialBalance = props.initialBalance;
      currency = initialBalance.currency;

      if (props.currency && props.currency.toUpperCase() !== currency) {
        throw new CurrencyMismatchError(props.currency, currency);
      }

      if (initialBalance.isNegative()) {
        throw new InvalidMoneyError("Initial balance cannot be negative");
      }
    } else if (props.currency) {
      currency = props.currency.trim().toUpperCase();
      initialBalance = Money.zero(currency);
    } else {
      throw new Error("Either initialBalance or currency must be provided");
    }

    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      currency,
      initialBalance,
      1,
      now,
      now,
    );
  }

  /**
   * Rehydrates a Wallet aggregate from persisted repository state without re-executing business rules.
   *
   * @param state - Complete snapshot from the database schema.
   * @returns Rehydrated Wallet aggregate root.
   */
  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debits the specified monetary amount from the wallet balance and increments its version.
   *
   * @param amount - Monetary value to subtract (must match wallet currency).
   * @throws {CurrencyMismatchError} When the amount currency differs from the wallet currency.
   * @throws {InvalidMoneyError} When debit amount is not strictly positive.
   * @throws {InsufficientFundsError} When the resulting balance would be negative.
   */
  public debit(amount: Money): void {
    this.assertSameCurrency(amount);

    if (!amount.isPositive()) {
      throw new InvalidMoneyError("Debit amount must be strictly positive");
    }

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientFundsError(
        this._balance.amount,
        amount.amount,
        this.currency,
      );
    }

    this._balance = this._balance.subtract(amount);
    this._version += 1;
    this._updatedAt = new Date();
  }

  /**
   * Credits the specified monetary amount into the wallet balance and increments its version.
   *
   * @param amount - Monetary value to add (must match wallet currency).
   * @throws {CurrencyMismatchError} When the amount currency differs from the wallet currency.
   * @throws {InvalidMoneyError} When credit amount is not strictly positive.
   */
  public credit(amount: Money): void {
    this.assertSameCurrency(amount);

    if (!amount.isPositive()) {
      throw new InvalidMoneyError("Credit amount must be strictly positive");
    }

    this._balance = this._balance.add(amount);
    this._version += 1;
    this._updatedAt = new Date();
  }

  private assertSameCurrency(money: Money): void {
    if (!money || money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money?.currency ?? "unknown");
    }
  }
}
