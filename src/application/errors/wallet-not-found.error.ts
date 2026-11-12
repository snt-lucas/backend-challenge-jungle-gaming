/**
 * Exceção lançada quando uma carteira requisitada não é encontrada na base de dados.
 */
export class WalletNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(public readonly walletId: string) {
    super(`Carteira com o ID "${walletId}" não foi encontrada.`);
    this.name = 'WalletNotFoundError';

    Object.setPrototypeOf(this, new.target.prototype);
  }
}