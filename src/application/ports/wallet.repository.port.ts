import type { Wallet } from "../../domain/entities/wallet.aggregate";

/**
 * Injection token for the WalletRepositoryPort contract.
 */
export const WALLET_REPOSITORY_PORT = Symbol("WALLET_REPOSITORY_PORT");

/**
 * Outbound repository port for persisting and querying player Wallet aggregates.
 */
export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}
