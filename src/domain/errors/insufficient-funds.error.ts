import { DomainError } from "./domain.error";

export class InsufficientFundsError extends DomainError {
  constructor(available: string, requested: string, currency: string) {
    super(
      `Insufficient funds in wallet: available ${available} ${currency}, requested debit of ${requested} ${currency}`,
    );
  }
}
