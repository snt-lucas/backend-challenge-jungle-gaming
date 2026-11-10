import { CurrencyMismatchError } from "../errors/currency-mismatch.error";
import { InvalidMoneyError } from "../errors/invalid-money.error";

export interface MoneyProps {
  amount: string; // decimal string com escala de 2 casas, ex: "25.00"
  currency: string; // ISO-4217, ex: "BRL"
}

export class Money {
  private readonly _cents: bigint;
  public readonly currency: string;

  private constructor(cents: bigint, currency: string) {
    this._cents = cents;
    this.currency = currency;
    Object.freeze(this);
  }

  public static from(
    props: MoneyProps,
    options: { allowNegative?: boolean } = {},
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

    // Rejeição explícita de NaN, Infinity ou strings especiais
    if (
      trimmedAmount === "" ||
      trimmedAmount.includes("NaN") ||
      trimmedAmount.includes("Infinity") ||
      trimmedAmount.includes("e") ||
      trimmedAmount.includes("E")
    ) {
      throw new InvalidMoneyError(`Invalid amount representation: "${amount}"`);
    }

    // Validação estrita de formato decimal com 2 casas
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

  public static zero(currency: string): Money {
    const trimmedCurrency = (currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(
        `Currency code must follow ISO-4217, got "${currency}"`,
      );
    }
    return new Money(0n, trimmedCurrency);
  }

  public static fromCents(cents: bigint, currency: string): Money {
    const trimmedCurrency = (currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(
        `Currency code must follow ISO-4217, got "${currency}"`,
      );
    }
    return new Money(cents, trimmedCurrency);
  }

  public get amount(): string {
    const isNegative = this._cents < 0n;
    const absCents = isNegative ? -this._cents : this._cents;
    const whole = absCents / 100n;
    const frac = absCents % 100n;
    const fracStr = frac.toString().padStart(2, "0");
    return `${isNegative ? "-" : ""}${whole.toString()}.${fracStr}`;
  }

  public get cents(): bigint {
    return this._cents;
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._cents + other._cents, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._cents - other._cents, this.currency);
  }

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
