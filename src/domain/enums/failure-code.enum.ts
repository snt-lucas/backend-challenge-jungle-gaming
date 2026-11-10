export enum FailureCode {
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceKindMismatch = "REFERENCE_KIND_MISMATCH",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  ReferenceRoundMismatch = "REFERENCE_ROUND_MISMATCH",
  ReferenceWalletMismatch = "REFERENCE_WALLET_MISMATCH",
  ReferenceCurrencyMismatch = "REFERENCE_CURRENCY_MISMATCH",
  AmountMismatch = "AMOUNT_MISMATCH",
  NegativeBalanceAfterRollback = "NEGATIVE_BALANCE_AFTER_ROLLBACK",
  InvalidPayload = "INVALID_PAYLOAD",
  ConcurrentConflict = "CONCURRENT_CONFLICT",
}
