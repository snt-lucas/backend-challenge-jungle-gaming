import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/**
 * Execution context store propagating correlation IDs, message identifiers, and trace IDs.
 */
export interface RequestContext {
  correlationId?: string | null;
  messageId?: string | null;
  transactionId?: string | null;
  walletId?: string | null;
  providerId?: string | null;
  [key: string]: unknown;
}

/**
 * AsyncLocalStorage-backed request context manager enabling contextual logging
 * and distributed tracing propagation without explicit parameter threading.
 */
@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Executes a callback within an isolated request context store.
   *
   * @param context - Context data store to associate with the current asynchronous execution chain.
   * @param fn - Asynchronous or synchronous callback to execute.
   * @returns Result returned by the callback.
   */
  public static run<R>(context: RequestContext, fn: () => R): R {
    return RequestContextService.storage.run(context, fn);
  }

  /**
   * Returns the active request context for the current asynchronous execution chain.
   *
   * @returns Active RequestContext store or undefined if running outside a context.
   */
  public static current(): RequestContext | undefined {
    return RequestContextService.storage.getStore();
  }

  /**
   * Instance method for dependency-injected execution in NestJS providers.
   *
   * @param context - Context data store to associate with execution.
   * @param fn - Callback to execute.
   * @returns Result returned by the callback.
   */
  public run<R>(context: RequestContext, fn: () => R): R {
    return RequestContextService.run(context, fn);
  }

  /**
   * Returns the active request context.
   *
   * @returns Active RequestContext store or undefined.
   */
  public getContext(): RequestContext | undefined {
    return RequestContextService.current();
  }

  /**
   * Retrieves a specific key from the active request context.
   *
   * @param key - Context property key name.
   * @returns Value associated with the key, or undefined.
   */
  public get<T = unknown>(key: keyof RequestContext | string): T | undefined {
    const store = RequestContextService.current();
    return store ? (store[key] as T) : undefined;
  }

  /**
   * Sets or updates a key-value pair in the active request context.
   *
   * @param key - Context property key name.
   * @param value - Value to assign.
   */
  public set(key: keyof RequestContext | string, value: unknown): void {
    const store = RequestContextService.current();
    if (store) {
      store[key] = value;
    }
  }

  /**
   * Merges multiple properties into the active request context store.
   *
   * @param partial - Partial context properties to merge.
   */
  public setContext(partial: Partial<RequestContext>): void {
    const store = RequestContextService.current();
    if (store) {
      Object.assign(store, partial);
    }
  }

  public getCorrelationId(): string | null {
    return this.get<string>("correlationId") ?? null;
  }

  public getMessageId(): string | null {
    return this.get<string>("messageId") ?? null;
  }

  public getTransactionId(): string | null {
    return this.get<string>("transactionId") ?? null;
  }

  public getWalletId(): string | null {
    return this.get<string>("walletId") ?? null;
  }

  public getProviderId(): string | null {
    return this.get<string>("providerId") ?? null;
  }
}
