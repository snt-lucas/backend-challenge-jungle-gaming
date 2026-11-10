import { CurrencyMismatchError } from "../errors/currency-mismatch.error";
import { InsufficientFundsError } from "../errors/insufficient-funds.error";
import { InvalidMoneyError } from "../errors/invalid-money.error";
import { Money } from "../value-objects/money.vo";

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance?: Money;
  currency?: string;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

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
