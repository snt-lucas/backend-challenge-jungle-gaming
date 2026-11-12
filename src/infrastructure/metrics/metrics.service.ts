import { Injectable } from "@nestjs/common";

/**
 * Snapshot of aggregated operational metrics counters and distribution statistics.
 */
export interface MetricsSnapshot {
  transactionsTotal: Record<string, number>;
  idempotencyDuplicatesTotal: number;
  messagingRetriesTotal: number;
  dlqMessagesTotal: number;
  lockContentionsTotal: number;
  outboxLagSeconds: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  };
  transactionProcessingDurationMs: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  };
}

/**
 * Real-time operational metrics collector and Prometheus/OpenMetrics exporter service.
 */
@Injectable()
export class MetricsService {
  private static instance?: MetricsService;

  private transactions = new Map<string, number>([
    ["PROCESSED", 0],
    ["REJECTED", 0],
    ["FAILED", 0],
    ["PENDING_REFERENCE", 0],
  ]);

  private idempotencyDuplicates = 0;
  private messagingRetries = 0;
  private dlqMessages = 0;
  private lockContentions = 0;

  private outboxLagSamples: number[] = [];
  private transactionDurationSamples: number[] = [];

  constructor() {
    MetricsService.instance = this;
  }

  /**
   * Returns the singleton instance of MetricsService.
   */
  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  /**
   * Increments the financial transactions total counter partitioned by status.
   *
   * @param status - Transaction outcome status (PROCESSED, REJECTED, FAILED, PENDING_REFERENCE).
   */
  public incrementTransactionsTotal(status: string): void {
    const normalized = status.toUpperCase();
    const current = this.transactions.get(normalized) ?? 0;
    this.transactions.set(normalized, current + 1);
  }

  /**
   * Increments the idempotency replay detection counter.
   */
  public incrementIdempotencyDuplicates(): void {
    this.idempotencyDuplicates++;
  }

  /**
   * Increments the message retry attempt counter.
   */
  public incrementMessagingRetries(): void {
    this.messagingRetries++;
  }

  /**
   * Increments the Dead-Letter Queue message forwarding counter.
   */
  public incrementDlqMessages(): void {
    this.dlqMessages++;
  }

  /**
   * Increments the row lock contention counter.
   */
  public incrementLockContentions(): void {
    this.lockContentions++;
  }

  /**
   * Records an outbox event dispatch latency sample in seconds.
   *
   * @param seconds - Elapsed time between event generation and broker publication.
   */
  public recordOutboxLag(seconds: number): void {
    if (seconds >= 0) {
      this.outboxLagSamples.push(Number(seconds.toFixed(4)));
    }
  }

  /**
   * Records a transaction processing execution duration in milliseconds.
   *
   * @param ms - Duration of transactional execution in milliseconds.
   */
  public recordTransactionDuration(ms: number): void {
    if (ms >= 0) {
      this.transactionDurationSamples.push(Number(ms.toFixed(2)));
    }
  }

  /**
   * Returns the count of processed transactions, optionally filtered by status.
   */
  public getTransactionsTotal(status?: string): number {
    if (status) {
      return this.transactions.get(status.toUpperCase()) ?? 0;
    }
    let total = 0;
    for (const count of this.transactions.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Returns the cumulative count of detected idempotency replays.
   */
  public getIdempotencyDuplicates(): number {
    return this.idempotencyDuplicates;
  }

  /**
   * Returns the cumulative count of message retry attempts.
   */
  public getMessagingRetries(): number {
    return this.messagingRetries;
  }

  /**
   * Returns the cumulative count of messages forwarded to DLQ.
   */
  public getDlqMessages(): number {
    return this.dlqMessages;
  }

  /**
   * Returns the cumulative count of lock contentions recorded.
   */
  public getLockContentions(): number {
    return this.lockContentions;
  }

  /**
   * Returns a copy of outbox lag latency samples.
   */
  public getOutboxLagSamples(): number[] {
    return [...this.outboxLagSamples];
  }

  /**
   * Returns a copy of transaction execution duration samples.
   */
  public getTransactionDurationSamples(): number[] {
    return [...this.transactionDurationSamples];
  }

  /**
   * Resets all internal metric counters and latency sample arrays.
   */
  public reset(): void {
    this.transactions.clear();
    this.transactions.set("PROCESSED", 0);
    this.transactions.set("REJECTED", 0);
    this.transactions.set("FAILED", 0);
    this.transactions.set("PENDING_REFERENCE", 0);
    this.idempotencyDuplicates = 0;
    this.messagingRetries = 0;
    this.dlqMessages = 0;
    this.lockContentions = 0;
    this.outboxLagSamples = [];
    this.transactionDurationSamples = [];
  }

  /**
   * Calculates distribution statistics and returns an aggregated snapshot of all recorded metrics.
   */
  public getSnapshot(): MetricsSnapshot {
    const calcStats = (samples: number[]) => {
      const count = samples.length;
      if (count === 0) {
        return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
      }
      const sum = samples.reduce((acc, v) => acc + v, 0);
      return {
        count,
        sum: Number(sum.toFixed(4)),
        avg: Number((sum / count).toFixed(4)),
        min: Math.min(...samples),
        max: Math.max(...samples),
      };
    };

    const transactionsTotal: Record<string, number> = {};
    for (const [key, val] of this.transactions.entries()) {
      transactionsTotal[key] = val;
    }

    return {
      transactionsTotal,
      idempotencyDuplicatesTotal: this.idempotencyDuplicates,
      messagingRetriesTotal: this.messagingRetries,
      dlqMessagesTotal: this.dlqMessages,
      lockContentionsTotal: this.lockContentions,
      outboxLagSeconds: calcStats(this.outboxLagSamples),
      transactionProcessingDurationMs: calcStats(this.transactionDurationSamples),
    };
  }

  /**
   * Renders the current metric counters and summaries in Prometheus text exposition format.
   */
  public toPrometheus(): string {
    const lines: string[] = [];

    lines.push("# HELP transactions_total Total de transações financeiras processadas por status");
    lines.push("# TYPE transactions_total counter");
    for (const [status, count] of this.transactions.entries()) {
      lines.push(`transactions_total{status="${status}"} ${count}`);
    }

    lines.push("# HELP idempotency_duplicates_total Total de detecções de replays e conflitos de chave de idempotência");
    lines.push("# TYPE idempotency_duplicates_total counter");
    lines.push(`idempotency_duplicates_total ${this.idempotencyDuplicates}`);

    lines.push("# HELP messaging_retries_total Total de retentativas em workers e consumidores SQS");
    lines.push("# TYPE messaging_retries_total counter");
    lines.push(`messaging_retries_total ${this.messagingRetries}`);

    lines.push("# HELP dlq_messages_total Total de mensagens direcionadas para Dead Letter Queue");
    lines.push("# TYPE dlq_messages_total counter");
    lines.push(`dlq_messages_total ${this.dlqMessages}`);

    lines.push("# HELP lock_contentions_total Total de ocorrências de espera ou contenção prolongada de lock em carteira");
    lines.push("# TYPE lock_contentions_total counter");
    lines.push(`lock_contentions_total ${this.lockContentions}`);

    const lagStats = this.getSnapshot().outboxLagSeconds;
    lines.push("# HELP outbox_lag_seconds Tempo decorrido entre occurred_at do evento e publicação na mensageria");
    lines.push("# TYPE outbox_lag_seconds summary");
    lines.push(`outbox_lag_seconds_sum ${lagStats.sum}`);
    lines.push(`outbox_lag_seconds_count ${lagStats.count}`);

    const durStats = this.getSnapshot().transactionProcessingDurationMs;
    lines.push("# HELP transaction_processing_duration_ms Latência de processamento das transações financeiras em milissegundos");
    lines.push("# TYPE transaction_processing_duration_ms summary");
    lines.push(`transaction_processing_duration_ms_sum ${durStats.sum}`);
    lines.push(`transaction_processing_duration_ms_count ${durStats.count}`);

    return lines.join("\n") + "\n";
  }
}
