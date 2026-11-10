export class WalletNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(walletId: string) {
    super(`Wallet with ID "${walletId}" was not found`);
    this.name = "WalletNotFoundError";
  }
}
