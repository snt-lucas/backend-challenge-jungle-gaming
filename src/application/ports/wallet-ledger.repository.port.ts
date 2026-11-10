import { WalletLedgerEntry } from "../../domain/entities/wallet-ledger-entry.entity";

export interface WalletLedgerRepositoryPort {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
}
