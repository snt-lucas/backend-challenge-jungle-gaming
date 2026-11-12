import type { WalletLedgerEntry } from "../../domain/entities/wallet-ledger-entry.entity";

/**
 * Injection token for the WalletLedgerRepositoryPort contract.
 */
export const WALLET_LEDGER_REPOSITORY_PORT = Symbol("WALLET_LEDGER_REPOSITORY_PORT");

/**
 * Outbound repository port for financial ledger audit entries.
 */
export interface WalletLedgerRepositoryPort {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(walletId: string, cursor?: string, limit?: number): Promise<WalletLedgerEntry[]>;
}
