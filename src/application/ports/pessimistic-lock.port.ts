/**
 * Injection token for the PessimisticLockPort contract.
 */
export const PESSIMISTIC_LOCK_PORT = Symbol("PESSIMISTIC_LOCK_PORT");

/**
 * Port contract for acquiring an exclusive pessimistic lock on a resource identifier.
 */
export interface PessimisticLockPort {
  acquire<T>(resourceId: string, action: () => Promise<T>): Promise<T>;
}
