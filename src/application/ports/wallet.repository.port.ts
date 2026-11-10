import { Wallet } from "../../domain/entities/wallet.aggregate";

export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}
