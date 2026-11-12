/**
 * Exceção lançada quando uma requisição é submetida com uma Idempotency-Key
 * já processada, porém com um payload diferente do original (hash de payload divergente).
 */
export class IdempotencyConflictError extends Error {
  public readonly statusCode = 409;

  constructor(public readonly idempotencyKey: string) {
    super(
      `Conflito de Idempotência: A chave '${idempotencyKey}' já foi utilizada com um payload diferente.`
    );
    this.name = 'IdempotencyConflictError';

    Object.setPrototypeOf(this, new.target.prototype);
  }
}