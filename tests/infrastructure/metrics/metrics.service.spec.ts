import { describe, it, expect, beforeEach } from "bun:test";
import { MetricsService } from "../../../src/infrastructure/metrics/metrics.service";
import { MetricsController } from "../../../src/infrastructure/metrics/metrics.controller";

describe("MetricsService & Telemetria Operacional", () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
    metricsService.reset();
  });

  describe("Contadores de Transações (transactions_total)", () => {
    it("deve incrementar transações por status corretamente", () => {
      metricsService.incrementTransactionsTotal("PROCESSED");
      metricsService.incrementTransactionsTotal("PROCESSED");
      metricsService.incrementTransactionsTotal("REJECTED");
      metricsService.incrementTransactionsTotal("FAILED");
      metricsService.incrementTransactionsTotal("PENDING_REFERENCE");

      expect(metricsService.getTransactionsTotal("PROCESSED")).toBe(2);
      expect(metricsService.getTransactionsTotal("REJECTED")).toBe(1);
      expect(metricsService.getTransactionsTotal("FAILED")).toBe(1);
      expect(metricsService.getTransactionsTotal("PENDING_REFERENCE")).toBe(1);
      expect(metricsService.getTransactionsTotal()).toBe(5);
    });
  });

  describe("Métricas de Idempotência, Mensageria e Concorrência", () => {
    it("deve registrar detecções de replays de idempotência", () => {
      metricsService.incrementIdempotencyDuplicates();
      metricsService.incrementIdempotencyDuplicates();

      expect(metricsService.getIdempotencyDuplicates()).toBe(2);
    });

    it("deve contabilizar retentativas de mensageria e workers", () => {
      metricsService.incrementMessagingRetries();
      metricsService.incrementMessagingRetries();
      metricsService.incrementMessagingRetries();

      expect(metricsService.getMessagingRetries()).toBe(3);
    });

    it("deve contabilizar mensagens encaminhadas para DLQ", () => {
      metricsService.incrementDlqMessages();

      expect(metricsService.getDlqMessages()).toBe(1);
    });

    it("deve contabilizar contenções de lock", () => {
      metricsService.incrementLockContentions();
      metricsService.incrementLockContentions();

      expect(metricsService.getLockContentions()).toBe(2);
    });
  });

  describe("Histogramas e Duração (Outbox Lag e Latência)", () => {
    it("deve registrar amostras de outbox lag e calcular estatísticas no snapshot", () => {
      metricsService.recordOutboxLag(0.12);
      metricsService.recordOutboxLag(0.35);
      metricsService.recordOutboxLag(0.20);

      const samples = metricsService.getOutboxLagSamples();
      expect(samples.length).toBe(3);
      expect(samples).toEqual([0.12, 0.35, 0.2]);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.outboxLagSeconds.count).toBe(3);
      expect(snapshot.outboxLagSeconds.min).toBe(0.12);
      expect(snapshot.outboxLagSeconds.max).toBe(0.35);
      expect(snapshot.outboxLagSeconds.sum).toBeCloseTo(0.67, 2);
    });

    it("deve registrar amostras de latência de transações", () => {
      metricsService.recordTransactionDuration(12.5);
      metricsService.recordTransactionDuration(25.0);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.transactionProcessingDurationMs.count).toBe(2);
      expect(snapshot.transactionProcessingDurationMs.avg).toBeCloseTo(18.75, 2);
      expect(snapshot.transactionProcessingDurationMs.min).toBe(12.5);
      expect(snapshot.transactionProcessingDurationMs.max).toBe(25.0);
    });
  });

  describe("Formatação Prometheus / OpenMetrics e Controller", () => {
    it("deve gerar texto no formato Prometheus com descrições e tipos corretos", () => {
      metricsService.incrementTransactionsTotal("PROCESSED");
      metricsService.incrementIdempotencyDuplicates();
      metricsService.incrementMessagingRetries();
      metricsService.incrementDlqMessages();
      metricsService.incrementLockContentions();
      metricsService.recordOutboxLag(0.15);
      metricsService.recordTransactionDuration(45.2);

      const promOutput = metricsService.toPrometheus();

      expect(promOutput).toContain('# HELP transactions_total');
      expect(promOutput).toContain('transactions_total{status="PROCESSED"} 1');
      expect(promOutput).toContain('# HELP idempotency_duplicates_total');
      expect(promOutput).toContain('idempotency_duplicates_total 1');
      expect(promOutput).toContain('# HELP messaging_retries_total');
      expect(promOutput).toContain('messaging_retries_total 1');
      expect(promOutput).toContain('# HELP dlq_messages_total');
      expect(promOutput).toContain('dlq_messages_total 1');
      expect(promOutput).toContain('# HELP lock_contentions_total');
      expect(promOutput).toContain('lock_contentions_total 1');
      expect(promOutput).toContain('# HELP outbox_lag_seconds');
      expect(promOutput).toContain('outbox_lag_seconds_count 1');
      expect(promOutput).toContain('# HELP transaction_processing_duration_ms');
      expect(promOutput).toContain('transaction_processing_duration_ms_count 1');
    });

    it("MetricsController deve retornar a exportação prometheus via GET /metrics", () => {
      const controller = new MetricsController(metricsService);
      metricsService.incrementTransactionsTotal("PROCESSED");

      const response = controller.getMetrics();
      expect(typeof response).toBe("string");
      expect(response).toContain('transactions_total{status="PROCESSED"} 1');
    });
  });
});
