import { DomainError } from "./domain.error";

export class InvalidTransactionOperationError extends DomainError {
  constructor(message: string) {
    super(`Invalid transaction operation: ${message}`);
  }
}
