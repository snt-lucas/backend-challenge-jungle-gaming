import { Injectable, Optional, type LoggerService } from "@nestjs/common";
import { RequestContextService } from "./request-context.service";
import { sanitizePayload } from "./payload-sanitizer";

/**
 * Supported severity levels for structured log emissions.
 */
export type LogLevel = "info" | "warn" | "error" | "debug" | "verbose" | "fatal";

/**
 * Standardized structured JSON log entry schema.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: string | null;
  correlationId: string | null;
  messageId: string | null;
  transactionId: string | null;
  walletId: string | null;
  providerId: string | null;
  traceId?: string | null;
  spanId?: string | null;
  data?: unknown;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Function contract for custom log line consumers (e.g. test assertions).
 */
export type LogWriter = (line: string, level: LogLevel) => void;

/**
 * Enterprise structured JSON logger implementing NestJS LoggerService,
 * automatically enriching log records with correlation IDs, tracing context, and masked PII.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private customWriter?: LogWriter;

  constructor(
    @Optional() private context?: string,
    @Optional() private readonly requestContextService?: RequestContextService,
  ) {}

  /**
   * Configures a custom output writer for testing or alternative log sinks.
   *
   * @param writer - Custom log writer callback.
   */
  public setWriter(writer: LogWriter): void {
    this.customWriter = writer;
  }

  /**
   * Sets the logging execution context name.
   *
   * @param context - Context name string.
   */
  public setContext(context: string): void {
    this.context = context;
  }

  /**
   * Writes an informational level log message.
   */
  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("info", message, optionalParams);
  }

  /**
   * Writes a warning level log message.
   */
  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("warn", message, optionalParams);
  }

  /**
   * Writes an error level log message with optional error stack trace.
   */
  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("error", message, optionalParams);
  }

  /**
   * Writes a debug level log message.
   */
  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("debug", message, optionalParams);
  }

  /**
   * Writes a verbose level log message.
   */
  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("verbose", message, optionalParams);
  }

  /**
   * Writes a fatal level log message.
   */
  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("fatal", message, optionalParams);
  }

  /**
   * Assembles, sanitizes, formats, and outputs the structured JSON log entry.
   */
  private writeLog(level: LogLevel, rawMessage: unknown, optionalParams: unknown[]): void {
    const contextStore =
      this.requestContextService?.getContext() ?? RequestContextService.current() ?? {};

    let stack: string | undefined;
    let messageStr = "";
    let dataPayload: unknown = undefined;

    if (rawMessage instanceof Error) {
      messageStr = rawMessage.message;
      stack = rawMessage.stack;
    } else if (typeof rawMessage === "string") {
      messageStr = rawMessage;
    } else {
      messageStr = JSON.stringify(sanitizePayload(rawMessage));
    }

    let resolvedContext = this.context ?? null;
    const extraArgs: unknown[] = [];

    for (let i = 0; i < optionalParams.length; i++) {
      const param = optionalParams[i];
      if (typeof param === "string" && i === optionalParams.length - 1 && !resolvedContext) {
        resolvedContext = param;
      } else if (typeof param === "string" && param.includes("\n") && !stack && level === "error") {
        stack = param;
      } else {
        extraArgs.push(param);
      }
    }

    if (extraArgs.length === 1) {
      dataPayload = sanitizePayload(extraArgs[0]);
    } else if (extraArgs.length > 1) {
      dataPayload = sanitizePayload(extraArgs);
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: messageStr,
      context: resolvedContext,
      correlationId: (contextStore.correlationId as string) ?? null,
      messageId: (contextStore.messageId as string) ?? null,
      transactionId: (contextStore.transactionId as string) ?? null,
      walletId: (contextStore.walletId as string) ?? null,
      providerId: (contextStore.providerId as string) ?? null,
      traceId: (contextStore.traceId as string) ?? null,
      spanId: (contextStore.spanId as string) ?? null,
    };

    if (dataPayload !== undefined) {
      entry.data = dataPayload;
    }

    if (stack) {
      entry.stack = stack;
    }

    const jsonString = JSON.stringify(entry);

    if (this.customWriter) {
      this.customWriter(jsonString, level);
    } else {
      if (level === "error" || level === "fatal") {
        process.stderr.write(jsonString + "\n");
      } else {
        process.stdout.write(jsonString + "\n");
      }
    }
  }
}
