/**
 * Properties for receiving and registering an incoming consumer message in the Inbox pattern.
 */
export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

/**
 * Snapshot representation of a persisted InboxMessage.
 */
export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

/**
 * Entity implementing the Inbox Pattern for idempotent message consumption.
 * Prevents duplicate execution from SQS message redeliveries via compound primary key.
 */
export class InboxMessage {
  protected constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  /**
   * Factory registering an incoming message.
   *
   * @throws {Error} When messageId, consumerName, or payloadHash is missing.
   */
  public static receive(props: ReceiveInboxProps): InboxMessage {
    if (!props.messageId || !props.consumerName || !props.payloadHash) {
      throw new Error("InboxMessage requires messageId, consumerName and payloadHash");
    }
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt ?? new Date(),
    );
  }

  /**
   * Rehydrates an inbox message from database persistence.
   */
  public static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  public markProcessed(at: Date = new Date()): void {
    this._processedAt = at;
  }
}
