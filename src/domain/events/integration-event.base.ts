import { randomUUID } from "node:crypto";

export interface IntegrationEventProps<T> {
  eventId?: string;
  aggregateId: string;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
  data: T;
}

export interface SerializedIntegrationEvent<T> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string; // ISO-8601 UTC
  version: number;
  data: T;
}

/**
 * Classe base abstrata para todos os eventos de integração do sistema.
 * Garante envelope uniforme e serialização estável de payloads.
 */
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly correlationId: string;
  public readonly causationId?: string;
  public readonly occurredAt: Date;
  public readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId ?? randomUUID();
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId ?? this.eventId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt ?? new Date();
    this.data = Object.freeze({ ...props.data });
  }

  /**
   * Serializa o envelope do evento para formato JSON estável.
   * `occurredAt` é sempre convertido para string ISO-8601 e `data` mantém tipos primitivos/MoneyProps.
   */
  public toJSON(): SerializedIntegrationEvent<T> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data as T,
    };
  }
}
