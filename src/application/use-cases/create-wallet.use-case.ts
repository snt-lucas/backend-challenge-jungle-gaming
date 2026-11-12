import { Inject, Injectable } from "@nestjs/common";
import { Wallet } from "../../domain/entities/wallet.aggregate";
import { Money } from "../../domain/value-objects/money.vo";
import { WALLET_REPOSITORY_PORT, type WalletRepositoryPort } from "../ports/wallet.repository.port";

/**
 * Output DTO for wallet creation or lookup.
 */
export interface CreateWalletOutput {
  id: string;
  userId: string;
  balance: string;
  currency: string;
  createdAt: Date;
}

/**
 * Use case managing player wallet creation or retrieval of existing wallet.
 */
@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
  ) {}

  /**
   * Retrieves an existing wallet for the player and currency, or opens a new one.
   *
   * @param userId - Player identifier.
   * @param currency - ISO-4217 currency code (default: 'BRL').
   * @returns Created or existing wallet summary.
   */
  async execute(userId: string, currency: string = "BRL"): Promise<CreateWalletOutput> {
    const existingWallet = await this.walletRepository.findByPlayerAndCurrency(userId, currency);
    if (existingWallet) {
      return {
        id: existingWallet.id,
        userId: existingWallet.playerId,
        balance: existingWallet.balance.amount,
        currency: existingWallet.balance.currency,
        createdAt: existingWallet.createdAt,
      };
    }

    const initialMoney = Money.zero(currency);
    const newWallet = Wallet.open({ id: crypto.randomUUID(), playerId: userId, initialBalance: initialMoney });

    await this.walletRepository.save(newWallet);

    return {
      id: newWallet.id,
      userId: newWallet.playerId,
      balance: newWallet.balance.amount,
      currency: newWallet.balance.currency,
      createdAt: newWallet.createdAt,
    };
  }
}
