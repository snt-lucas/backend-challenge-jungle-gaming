import { randomUUID } from "node:crypto";

export interface EnqueueOutboxProps {
  id?: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

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

  public scheduleRetry(now: Date = new Date()): void {
    this._attempts += 1;
    // Backoff exponencial simples: 2^attempts segundos
    const backoffSeconds = Math.min(Math.pow(2, this._attempts), 300);
    this._nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000);
  }
}
