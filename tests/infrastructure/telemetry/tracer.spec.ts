import { describe, it, expect, beforeEach } from "bun:test";
import { OpenTelemetryTracer } from "../../../src/infrastructure/telemetry/tracer";
import { RequestContextService } from "../../../src/infrastructure/logging/request-context.service";
import { AppLogger, type LogEntry } from "../../../src/infrastructure/logging/app-logger.service";

describe("OpenTelemetryTracer & Rastreamento Distribuído (Seção 12)", () => {
  let tracer: OpenTelemetryTracer;
  let contextService: RequestContextService;
  let logger: AppLogger;
  let loggedEntries: LogEntry[];

  beforeEach(() => {
    tracer = new OpenTelemetryTracer();
    tracer.clearCompletedSpans();

    contextService = new RequestContextService();
    logger = new AppLogger("TelemetryTest", contextService);
    loggedEntries = [];

    logger.setWriter((line: string) => {
      loggedEntries.push(JSON.parse(line));
    });
  });

  it("deve gerar span com IDs conformes com W3C (traceId 32 chars, spanId 16 chars hex)", async () => {
    await tracer.trace("HTTP POST /wagering/transactions", (span) => {
      expect(span.traceId).toBeDefined();
      expect(span.traceId.length).toBe(32);
      expect(/^[0-9a-f]{32}$/.test(span.traceId)).toBe(true);

      expect(span.spanId).toBeDefined();
      expect(span.spanId.length).toBe(16);
      expect(/^[0-9a-f]{16}$/.test(span.spanId)).toBe(true);

      span.setAttribute("http.status_code", 201);
      span.setAttribute("wallet.id", "wal-123");
    });

    const spans = tracer.getCompletedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]?.name).toBe("HTTP POST /wagering/transactions");
    expect(spans[0]?.status).toBe("OK");
    expect(spans[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(spans[0]?.attributes["http.status_code"]).toBe(201);
    expect(spans[0]?.attributes["wallet.id"]).toBe("wal-123");
  });

  it("deve propagar o mesmo traceId em spans aninhados (hierarquia pai/filho)", async () => {
    await tracer.trace("parent-operation", async (parentSpan) => {
      parentSpan.setAttribute("parent.key", "val-1");

      await tracer.trace("child-db-query", (childSpan) => {
        expect(childSpan.traceId).toBe(parentSpan.traceId);
        expect(childSpan.spanId).not.toBe(parentSpan.spanId);
      });
    });

    const spans = tracer.getCompletedSpans();
    expect(spans.length).toBe(2);

    const child = spans.find((s) => s.name === "child-db-query");
    const parent = spans.find((s) => s.name === "parent-operation");

    expect(child?.traceId).toBe(parent?.traceId);
    expect(child?.parentSpanId).toBe(parent?.spanId);
  });

  it("deve correlacionar traceId e spanId com o AppLogger e o RequestContextService", async () => {
    await contextService.run({ correlationId: "corr-otel-999" }, async () => {
      await tracer.trace("http-request-handler", () => {
        logger.log("Processando transação com telemetria ativa");
      });
    });

    expect(loggedEntries.length).toBe(1);
    const log = loggedEntries[0]!;

    expect(log.correlationId).toBe("corr-otel-999");
    expect(log.traceId).toBeDefined();
    expect(log.traceId?.length).toBe(32);
    expect(log.spanId).toBeDefined();
    expect(log.spanId?.length).toBe(16);
  });

  it("deve marcar status ERROR quando a execução lançar exceção", async () => {
    let errorCaught = false;

    try {
      await tracer.trace("failing-operation", () => {
        throw new Error("Erro de infraestrutura simulado");
      });
    } catch {
      errorCaught = true;
    }

    expect(errorCaught).toBe(true);

    const spans = tracer.getCompletedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]?.status).toBe("ERROR");
    expect((spans[0]?.error as Error).message).toBe("Erro de infraestrutura simulado");
  });
});
