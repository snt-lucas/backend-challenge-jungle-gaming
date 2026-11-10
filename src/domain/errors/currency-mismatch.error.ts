import { DomainError } from "./domain.error";

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`);
  }
}
