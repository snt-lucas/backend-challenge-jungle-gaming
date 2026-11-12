import { CurrencyMismatchError } from "../errors/currency-mismatch.error";
import { InvalidMoneyError } from "../errors/invalid-money.error";

/**
 * Monetary properties payload representing amount and ISO-4217 currency.
 */
export interface MoneyProps {
  amount: string;
  currency: string;
}

/**
 * Options configuring monetary creation behavior.
 */
export interface MoneyOptions {
  allowNegative?: boolean;
}

/**
 * Immutable value object representing a monetary quantity with exact scale.
 * Enforces ISO-4217 currency validation, strict two-decimal scale, and integer arithmetic in cents.
 */
export class Money {
  private readonly _cents: bigint;
  public readonly currency: string;

  private constructor(cents: bigint, currency: string) {
    this._cents = cents;
    this.currency = currency;
    Object.freeze(this);
  }

  /**
   * Creates a Money instance from standard string representation.
   *
   * @param props - Amount string with exactly 2 decimal places and ISO-4217 currency code.
   * @param options - Configuration allowing negative values when explicitly enabled.
   * @returns An immutable Money instance.
   * @throws {InvalidMoneyError} When format, decimal scale or currency code is invalid.
   */
  public static from(
    props: MoneyProps,
    options: MoneyOptions = {},
  ): Money {
    if (!props || typeof props !== "object") {
      throw new InvalidMoneyError("Props must be an object");
    }

    const { amount, currency } = props;

    if (typeof amount !== "string") {
      throw new InvalidMoneyError(
        `Amount must be a string, received ${typeof amount}`,
      );
    }

    if (typeof currency !== "string") {
      throw new InvalidMoneyError("Currency must be a string");
    }

    const trimmedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(
        `Currency code must follow ISO-4217 (3 uppercase letters), got "${currency}"`,
      );
    }

    const trimmedAmount = amount.trim();

    if (
      trimmedAmount === "" ||
      trimmedAmount.includes("NaN") ||
      trimmedAmount.includes("Infinity") ||
      trimmedAmount.includes("e") ||
      trimmedAmount.includes("E")
    ) {
      throw new InvalidMoneyError(`Invalid amount representation: "${amount}"`);
    }

    const pattern = options.allowNegative
      ? /^-?\d+\.\d{2}$/
      : /^\d+\.\d{2}$/;

    if (!pattern.test(trimmedAmount)) {
      if (/^-?\d+(\.\d+)?$/.test(trimmedAmount)) {
        if (!options.allowNegative && trimmedAmount.startsWith("-")) {
          throw new InvalidMoneyError("Negative amounts are not allowed");
        }
        throw new InvalidMoneyError(
          `Amount must have exactly 2 decimal places, got "${amount}"`,
        );
      }
      throw new InvalidMoneyError(`Malformed amount string: "${amount}"`);
    }

    const isNegative = trimmedAmount.startsWith("-");
    const cleanAmount = isNegative ? trimmedAmount.slice(1) : trimmedAmount;
    const parts = cleanAmount.split(".");
    const wholeStr = parts[0]!;
    const fracStr = parts[1]!;

    const wholeBigInt = BigInt(wholeStr);
    const fracBigInt = BigInt(fracStr);
    const totalCents = wholeBigInt * 100n + fracBigInt;
    const finalCents = isNegative ? -totalCents : totalCents;

    return new Money(finalCents, trimmedCurrency);
  }

  /**
   * Creates a Money instance representing zero amount for the specified currency.
   *
   * @param currency - Valid ISO-4217 currency code.
   * @returns Money instance with 0.00 value.
   * @throws {InvalidMoneyError} When currency code is invalid.
   */
  public static zero(currency: string): Money {
    const trimmedCurrency = (currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(
        `Currency code must follow ISO-4217, got "${currency}"`,
      );
    }
    return new Money(0n, trimmedCurrency);
  }

  /**
   * Creates a Money instance directly from integer cents representation.
   *
   * @param cents - Integer quantity representing cents (e.g., 1000n for 10.00).
   * @param currency - Valid ISO-4217 currency code.
   * @returns An immutable Money instance.
   * @throws {InvalidMoneyError} When currency code is invalid.
   */
  public static fromCents(cents: bigint, currency: string): Money {
    const trimmedCurrency = (currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(
        `Currency code must follow ISO-4217, got "${currency}"`,
      );
    }
    return new Money(cents, trimmedCurrency);
  }

  /**
   * Formatted two-decimal amount string (e.g., "10.00").
   */
  public get amount(): string {
    const isNegative = this._cents < 0n;
    const absCents = isNegative ? -this._cents : this._cents;
    const whole = absCents / 100n;
    const frac = absCents % 100n;
    const fracStr = frac.toString().padStart(2, "0");
    return `${isNegative ? "-" : ""}${whole.toString()}.${fracStr}`;
  }

  /**
   * Total quantity in integer cents.
   */
  public get cents(): bigint {
    return this._cents;
  }

  /**
   * Adds another monetary amount of the same currency.
   *
   * @param other - Value to add.
   * @returns New Money instance containing the sum.
   * @throws {CurrencyMismatchError} When currencies do not match.
   */
  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._cents + other._cents, this.currency);
  }

  /**
   * Subtracts another monetary amount of the same currency.
   *
   * @param other - Value to subtract.
   * @returns New Money instance containing the difference.
   * @throws {CurrencyMismatchError} When currencies do not match.
   */
  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._cents - other._cents, this.currency);
  }

  /**
   * Negates this monetary amount.
   *
   * @returns New Money instance with inverted sign.
   */
  public negate(): Money {
    return new Money(-this._cents, this.currency);
  }

  public isZero(): boolean {
    return this._cents === 0n;
  }

  public isPositive(): boolean {
    return this._cents > 0n;
  }

  public isNegative(): boolean {
    return this._cents < 0n;
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._cents < other._cents;
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._cents > other._cents;
  }

  public isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._cents <= other._cents;
  }

  public isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._cents >= other._cents;
  }

  public equals(other: Money): boolean {
    if (!other || this.currency !== other.currency) {
      return false;
    }
    return this._cents === other._cents;
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  public toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (!other || this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other?.currency ?? "unknown");
    }
  }
}
