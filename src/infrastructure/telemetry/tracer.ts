import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { RequestContextService } from "../logging/request-context.service";

/**
 * OpenTelemetry span execution context holding trace identifiers, timings, and metadata.
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: "OK" | "ERROR";
  error?: unknown;
}

/**
 * Handle contract representing an active tracing span.
 */
export interface Span {
  traceId: string;
  spanId: string;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attrs: Record<string, unknown>): void;
  setStatus(status: "OK" | "ERROR", error?: unknown): void;
  end(): void;
  getContext(): SpanContext;
}

/**
 * Consumer callback invoked when a tracing span is closed.
 */
export type SpanExporter = (span: SpanContext) => void;

/**
 * Lightweight, zero-dependency OpenTelemetry-compatible distributed tracer.
 */
export class OpenTelemetryTracer {
  private static instance: OpenTelemetryTracer;
  private readonly spanStorage = new AsyncLocalStorage<SpanContext>();
  private exporter?: SpanExporter;
  private readonly completedSpans: SpanContext[] = [];

  constructor() {
    OpenTelemetryTracer.instance = this;
  }

  /**
   * Returns the singleton tracer instance.
   */
  public static getInstance(): OpenTelemetryTracer {
    if (!OpenTelemetryTracer.instance) {
      OpenTelemetryTracer.instance = new OpenTelemetryTracer();
    }
    return OpenTelemetryTracer.instance;
  }

  /**
   * Configures a custom exporter callback receiving ended spans.
   */
  public setExporter(exporter: SpanExporter): void {
    this.exporter = exporter;
  }

  /**
   * Returns a copy of all completed span records.
   */
  public getCompletedSpans(): readonly SpanContext[] {
    return [...this.completedSpans];
  }

  /**
   * Clears the completed span buffer.
   */
  public clearCompletedSpans(): void {
    this.completedSpans.length = 0;
  }

  /**
   * Generates a random 16-byte hex trace identifier.
   */
  public generateTraceId(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Generates a random 8-byte hex span identifier.
   */
  public generateSpanId(): string {
    return randomBytes(8).toString("hex");
  }

  /**
   * Returns the currently active span context in the asynchronous execution chain.
   */
  public getActiveSpan(): SpanContext | undefined {
    return this.spanStorage.getStore();
  }

  /**
   * Returns the active trace identifier string if present.
   */
  public getActiveTraceId(): string | null {
    return this.getActiveSpan()?.traceId ?? null;
  }

  /**
   * Returns the active span identifier string if present.
   */
  public getActiveSpanId(): string | null {
    return this.getActiveSpan()?.spanId ?? null;
  }

  /**
   * Executes a callback wrapped inside an active OpenTelemetry tracing span.
   *
   * @param name - Operation name describing the span.
   * @param fn - Asynchronous or synchronous callback executed while the span is active.
   * @param parentContext - Optional trace and span identifiers to link as parent span.
   * @returns Result returned by the callback.
   */
  public async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    parentContext?: { traceId?: string; spanId?: string; correlationId?: string },
  ): Promise<T> {
    const parentSpan = this.getActiveSpan();
    const traceId = parentContext?.traceId || parentSpan?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentSpanId = parentContext?.spanId || parentSpan?.spanId;

    const spanContext: SpanContext = {
      traceId,
      spanId,
      parentSpanId,
      name,
      startTime: performance.now(),
      attributes: {},
      status: "OK",
    };

    const requestContext = RequestContextService.current();
    if (requestContext) {
      requestContext.traceId = traceId;
      requestContext.spanId = spanId;
      if (parentContext?.correlationId && !requestContext.correlationId) {
        requestContext.correlationId = parentContext.correlationId;
      }
    }

    const span: Span = {
      traceId,
      spanId,
      setAttribute: (key: string, value: unknown) => {
        spanContext.attributes[key] = value;
      },
      setAttributes: (attrs: Record<string, unknown>) => {
        Object.assign(spanContext.attributes, attrs);
      },
      setStatus: (status: "OK" | "ERROR", error?: unknown) => {
        spanContext.status = status;
        if (error) {
          spanContext.error = error;
        }
      },
      end: () => {
        if (!spanContext.endTime) {
          spanContext.endTime = performance.now();
          spanContext.durationMs = Number(
            (spanContext.endTime - spanContext.startTime).toFixed(2),
          );
          this.completedSpans.push(spanContext);
          if (this.exporter) {
            this.exporter(spanContext);
          }
        }
      },
      getContext: () => ({ ...spanContext }),
    };

    return await this.spanStorage.run(spanContext, async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err) {
        span.setStatus("ERROR", err);
        span.end();
        throw err;
      }
    });
  }
}
