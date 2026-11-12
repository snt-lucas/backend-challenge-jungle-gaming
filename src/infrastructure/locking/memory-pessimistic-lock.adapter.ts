import type { PessimisticLockPort } from "../../application/ports/pessimistic-lock.port";

/**
 * In-memory FIFO queue adapter implementing PessimisticLockPort for single-process serialization.
 */
export class MemoryPessimisticLockAdapter implements PessimisticLockPort {
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Acquires a serialized lock on a resource identifier and runs the provided action.
   *
   * @param resourceId - Unique resource identifier (e.g. wallet ID).
   * @param action - Asynchronous callback to execute while holding the lock.
   * @returns Result returned by the action callback.
   */
  public async acquire<T>(resourceId: string, action: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(resourceId) ?? Promise.resolve();

    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.queues.set(
      resourceId,
      currentQueue.then(() => nextLock),
    );

    try {
      await currentQueue;
      return await action();
    } finally {
      releaseLock();
      if (this.queues.get(resourceId) === nextLock) {
        this.queues.delete(resourceId);
      }
    }
  }
}
