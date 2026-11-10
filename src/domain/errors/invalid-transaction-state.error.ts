import { DomainError } from "./domain.error";

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(`Invalid transaction state: ${message}`);
  }
}
