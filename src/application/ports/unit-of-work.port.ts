/**
 * Injection token for the UnitOfWorkPort contract.
 */
export const UNIT_OF_WORK_PORT = Symbol("UNIT_OF_WORK_PORT");

/**
 * Port contract for executing operations within an atomic transactional boundary.
 */
export interface UnitOfWorkPort {
  execute<T>(work: () => Promise<T>): Promise<T>;
}
