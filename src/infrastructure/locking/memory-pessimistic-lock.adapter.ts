import { PessimisticLockPort } from "../../application/ports/pessimistic-lock.port";

export class MemoryPessimisticLockAdapter implements PessimisticLockPort {
  private readonly queues = new Map<string, Promise<unknown>>();

  public async acquire<T>(resourceId: string, action: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(resourceId) ?? Promise.resolve();

    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Encadeia a próxima ação na fila específica deste resourceId
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
