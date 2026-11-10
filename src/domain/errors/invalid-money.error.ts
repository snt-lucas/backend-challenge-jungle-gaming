import { DomainError } from "./domain.error";

export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super(`Invalid money: ${message}`);
  }
}
