import { randomUUID } from "node:crypto";

/**
 * Properties required to enqueue an integration event into the transactional outbox.
 */
export interface EnqueueOutboxProps {
  id?: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Snapshot representation of a persisted OutboxMessage.
 */
export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

/**
 * Entity implementing the Transactional Outbox pattern.
 * Stores integration events in the same ACID commit as financial operations for reliable asynchronous dispatch.
 */
export class OutboxMessage {
  protected constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number = 0,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  /**
   * Factory enqueuing an integration event for reliable outbox publishing.
   *
   * @throws {Error} When aggregateId, eventType or payload is missing.
   */
  public static enqueue(props: EnqueueOutboxProps): OutboxMessage {
    if (!props.aggregateId || !props.eventType || !props.payload) {
      throw new Error("OutboxMessage requires aggregateId, eventType and payload");
    }
    return new OutboxMessage(
      props.id ?? randomUUID(),
      props.aggregateId,
      props.eventType,
      Object.freeze({ ...props.payload }),
      props.occurredAt ?? new Date(),
      0,
    );
  }

  /**
   * Rehydrates an outbox message from database persistence.
   */
  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (this._publishedAt) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  /**
   * Schedules a retry attempt using exponential backoff or an explicit delay interval.
   *
   * @param backoffOrNow - Delay interval in seconds or reference timestamp.
   * @param now - Reference timestamp if delay was provided as the first argument.
   */
  public scheduleRetry(
    backoffOrNow?: number | Date,
    now: Date = new Date(),
  ): void {
    this._attempts += 1;
    let backoffSeconds: number;
    let referenceTime: Date;

    if (typeof backoffOrNow === "number") {
      backoffSeconds = backoffOrNow;
      referenceTime = now;
    } else if (backoffOrNow instanceof Date) {
      referenceTime = backoffOrNow;
      backoffSeconds = Math.min(Math.pow(2, this._attempts), 300);
    } else {
      referenceTime = now;
      backoffSeconds = Math.min(Math.pow(2, this._attempts), 300);
    }

    this._nextAttemptAt = new Date(referenceTime.getTime() + backoffSeconds * 1000);
  }
}
