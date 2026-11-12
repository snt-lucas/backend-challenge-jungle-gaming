import { Inject, Injectable } from "@nestjs/common";
import { WALLET_REPOSITORY_PORT, type WalletRepositoryPort } from "@application/ports/wallet.repository.port";
import { WalletNotFoundError } from "@application/errors";

/**
 * Output DTO for wallet queries.
 */
export interface GetWalletOutput {
  id: string;
  userId: string;
  balance: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Use case querying wallet balance and metadata by wallet identifier.
 */
@Injectable()
export class GetWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
  ) {}

  /**
   * Retrieves wallet details by ID.
   *
   * @param walletId - Unique wallet identifier.
   * @throws {WalletNotFoundError} When wallet does not exist.
   */
  async execute(walletId: string): Promise<GetWalletOutput> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return {
      id: wallet.id,
      userId: wallet.playerId,
      balance: wallet.balance.amount,
      currency: wallet.balance.currency,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
