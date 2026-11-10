export interface PessimisticLockPort {
  acquire<T>(resourceId: string, action: () => Promise<T>): Promise<T>;
}
