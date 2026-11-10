import { FailureCode } from "../enums/failure-code.enum";
import { LedgerDirection } from "../enums/ledger-direction.enum";
import { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../enums/wager-transaction-status.enum";
import { InvalidTransactionOperationError } from "../errors/invalid-transaction-operation.error";
import { InvalidTransactionStateError } from "../errors/invalid-transaction-state.error";
import { Money } from "../value-objects/money.vo";

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  protected constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !props.referenceExternalTransactionId
    ) {
      throw new InvalidTransactionOperationError(
        `Operation ${props.kind} requires referenceExternalTransactionId`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Loss:
        throw new InvalidTransactionOperationError(
          "LOSS operations do not affect balance or generate ledger entries",
        );
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new InvalidTransactionOperationError(
            "Rollback requires referenced transaction to calculate direction",
          );
        }
        if (reference.kind === WagerTransactionKind.Bet) {
          return LedgerDirection.Credit;
        }
        if (
          reference.kind === WagerTransactionKind.Win ||
          reference.kind === WagerTransactionKind.Refund
        ) {
          return LedgerDirection.Debit;
        }
        throw new InvalidTransactionOperationError(
          `Cannot rollback transaction of kind ${reference.kind}`,
        );
      }
      default:
        throw new InvalidTransactionOperationError(
          `Unknown transaction kind: ${this.kind}`,
        );
    }
  }

  public validateReference(reference: WagerTransaction): void {
    if (this.providerId !== reference.providerId) {
      throw new InvalidTransactionOperationError(
        `Reference provider mismatch: expected ${this.providerId}, got ${reference.providerId}`,
      );
    }

    if (this.playerId !== reference.playerId) {
      throw new InvalidTransactionOperationError(
        `Reference player mismatch: expected ${this.playerId}, got ${reference.playerId}`,
      );
    }

    if (this.walletId !== reference.walletId) {
      throw new InvalidTransactionOperationError(
        `Reference wallet mismatch: expected ${this.walletId}, got ${reference.walletId}`,
      );
    }

    if (this.roundId !== reference.roundId) {
      throw new InvalidTransactionOperationError(
        `Reference round mismatch: expected ${this.roundId}, got ${reference.roundId}`,
      );
    }

    if (this.money.currency !== reference.money.currency) {
      throw new InvalidTransactionOperationError(
        `Reference currency mismatch: expected ${this.money.currency}, got ${reference.money.currency}`,
      );
    }

    if (!this.money.equals(reference.money)) {
      throw new InvalidTransactionOperationError(
        `Amount mismatch: expected ${this.money.amount}, got ${reference.money.amount}. Partial reversal is not allowed`,
      );
    }

    if (this.kind === WagerTransactionKind.Refund) {
      if (reference.kind !== WagerTransactionKind.Bet) {
        throw new InvalidTransactionOperationError(
          `REFUND can only reference a BET transaction, but referenced ${reference.kind}`,
        );
      }
    } else if (this.kind === WagerTransactionKind.Rollback) {
      if (
        reference.kind !== WagerTransactionKind.Bet &&
        reference.kind !== WagerTransactionKind.Win &&
        reference.kind !== WagerTransactionKind.Refund
      ) {
        throw new InvalidTransactionOperationError(
          `ROLLBACK can only reference BET, WIN or REFUND, but referenced ${reference.kind}`,
        );
      }
    }
  }

  public markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
  ): void {
    this.assertNotTerminal("mark as processed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  public markPendingReference(): void {
    this.assertNotTerminal("mark as pending reference");
    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: FailureCode): void {
    this.assertNotTerminal("reject");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  public fail(code: FailureCode): void {
    this.assertNotTerminal("fail");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot ${action} on transaction ${this.id} because it is already in terminal state ${this._status}`,
      );
    }
  }
}
