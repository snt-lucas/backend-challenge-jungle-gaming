import { LedgerDirection } from "../enums/ledger-direction.enum";
import { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import { Money } from "../value-objects/money.vo";
import { DomainError } from "../errors/domain.error";

/**
 * Domain error thrown when a double-entry journal entry debits do not equal credits.
 */
export class UnbalancedJournalEntryError extends DomainError {
  constructor(debitTotal: string, creditTotal: string, currency: string) {
    super(
      `Unbalanced double-entry journal posting: Total Debits = ${debitTotal} ${currency}, Total Credits = ${creditTotal} ${currency}`,
    );
  }
}

/**
 * Domain error thrown when posting specifications or currency consistency rules are violated.
 */
export class InvalidDoubleEntryPostingError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Input properties for an individual financial posting in a double-entry transaction.
 */
export interface PostingProps {
  id?: string;
  accountId: string;
  direction: LedgerDirection;
  money: Money;
  description?: string;
}

/**
 * Individual leg of a double-entry posting.
 */
export class DoubleEntryPosting {
  public readonly id?: string;
  public readonly accountId: string;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly description?: string;

  constructor(props: PostingProps) {
    this.id = props.id;
    this.accountId = props.accountId;
    this.direction = props.direction;
    this.money = props.money;
    this.description = props.description;
    Object.freeze(this);
  }
}

/**
 * Initialization properties for a complete double-entry transaction.
 */
export interface DoubleEntryTransactionProps {
  id: string;
  transactionId: string;
  kind: WagerTransactionKind;
  occurredAt?: Date;
  postings: DoubleEntryPosting[];
}

/**
 * Domain entity representing a double-entry financial journal entry.
 * Enforces the strict invariant: sum(Debits) === sum(Credits).
 */
export class DoubleEntryTransaction {
  public readonly id: string;
  public readonly transactionId: string;
  public readonly kind: WagerTransactionKind;
  public readonly occurredAt: Date;
  public readonly postings: readonly DoubleEntryPosting[];

  private constructor(props: DoubleEntryTransactionProps) {
    this.id = props.id;
    this.transactionId = props.transactionId;
    this.kind = props.kind;
    this.occurredAt = props.occurredAt ?? new Date();
    this.postings = Object.freeze([...props.postings]);
    this.validateBalance();
    Object.freeze(this);
  }

  /**
   * Factory creating a validated double-entry transaction.
   *
   * @throws {InvalidDoubleEntryPostingError} When postings count < 2 or currencies diverge.
   * @throws {UnbalancedJournalEntryError} When debits do not equal credits.
   */
  public static create(props: DoubleEntryTransactionProps): DoubleEntryTransaction {
    return new DoubleEntryTransaction(props);
  }

  /**
   * Creates a balanced Bet double-entry transaction:
   * Debit: Player Wallet (WALLET:{walletId})
   * Credit: House Escrow (HOUSE:ESCROW:{providerId})
   */
  public static createBet(props: {
    id: string;
    transactionId: string;
    walletId: string;
    providerId: string;
    money: Money;
  }): DoubleEntryTransaction {
    return new DoubleEntryTransaction({
      id: props.id,
      transactionId: props.transactionId,
      kind: WagerTransactionKind.Bet,
      postings: [
        new DoubleEntryPosting({
          accountId: `WALLET:${props.walletId}`,
          direction: LedgerDirection.Debit,
          money: props.money,
          description: `Player bet debit on wallet ${props.walletId}`,
        }),
        new DoubleEntryPosting({
          accountId: `HOUSE:ESCROW:${props.providerId}`,
          direction: LedgerDirection.Credit,
          money: props.money,
          description: `House escrow custody credit for provider ${props.providerId}`,
        }),
      ],
    });
  }

  /**
   * Creates a balanced Win double-entry transaction:
   * Debit: House Revenue (HOUSE:REVENUE:{providerId})
   * Credit: Player Wallet (WALLET:{walletId})
   */
  public static createWin(props: {
    id: string;
    transactionId: string;
    walletId: string;
    providerId: string;
    money: Money;
  }): DoubleEntryTransaction {
    return new DoubleEntryTransaction({
      id: props.id,
      transactionId: props.transactionId,
      kind: WagerTransactionKind.Win,
      postings: [
        new DoubleEntryPosting({
          accountId: `HOUSE:REVENUE:${props.providerId}`,
          direction: LedgerDirection.Debit,
          money: props.money,
          description: `House prize payout debit for provider ${props.providerId}`,
        }),
        new DoubleEntryPosting({
          accountId: `WALLET:${props.walletId}`,
          direction: LedgerDirection.Credit,
          money: props.money,
          description: `Player prize win credit on wallet ${props.walletId}`,
        }),
      ],
    });
  }

  /**
   * Creates a balanced Refund or Rollback double-entry transaction:
   * Debit: House Escrow (HOUSE:ESCROW:{providerId})
   * Credit: Player Wallet (WALLET:{walletId})
   */
  public static createRefund(props: {
    id: string;
    transactionId: string;
    walletId: string;
    providerId: string;
    money: Money;
    kind?: WagerTransactionKind;
  }): DoubleEntryTransaction {
    return new DoubleEntryTransaction({
      id: props.id,
      transactionId: props.transactionId,
      kind: props.kind ?? WagerTransactionKind.Refund,
      postings: [
        new DoubleEntryPosting({
          accountId: `HOUSE:ESCROW:${props.providerId}`,
          direction: LedgerDirection.Debit,
          money: props.money,
          description: `House escrow custody release debit`,
        }),
        new DoubleEntryPosting({
          accountId: `WALLET:${props.walletId}`,
          direction: LedgerDirection.Credit,
          money: props.money,
          description: `Player refund return credit on wallet ${props.walletId}`,
        }),
      ],
    });
  }

  public get totalDebits(): Money {
    if (this.postings.length === 0) return Money.zero("BRL");
    const currency = this.postings[0]!.money.currency;
    return this.postings
      .filter((p) => p.direction === LedgerDirection.Debit)
      .reduce((acc, p) => acc.add(p.money), Money.zero(currency));
  }

  public get totalCredits(): Money {
    if (this.postings.length === 0) return Money.zero("BRL");
    const currency = this.postings[0]!.money.currency;
    return this.postings
      .filter((p) => p.direction === LedgerDirection.Credit)
      .reduce((acc, p) => acc.add(p.money), Money.zero(currency));
  }

  public isBalanced(): boolean {
    if (this.postings.length < 2) return false;
    return this.totalDebits.equals(this.totalCredits);
  }

  private validateBalance(): void {
    if (this.postings.length < 2) {
      throw new InvalidDoubleEntryPostingError(
        "A double-entry transaction must contain at least 2 postings",
      );
    }

    const firstCurrency = this.postings[0]!.money.currency;
    for (const p of this.postings) {
      if (p.money.currency !== firstCurrency) {
        throw new InvalidDoubleEntryPostingError(
          "All postings in a double-entry transaction must have the same currency",
        );
      }
    }

    if (!this.totalDebits.equals(this.totalCredits)) {
      throw new UnbalancedJournalEntryError(
        this.totalDebits.amount,
        this.totalCredits.amount,
        firstCurrency,
      );
    }
  }
}
