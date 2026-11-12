import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { CreateWalletUseCase } from "../../../application/use-cases/create-wallet.use-case";
import { GetWalletUseCase } from "@application/use-cases/get-wallet.use-case";
import { ReconcileWalletUseCase } from "@application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "@application/use-cases/get-wallet-ledger.use-case";
import { WalletNotFoundError } from "@application/errors";

/**
 * Data transfer object for creating a new wallet.
 */
export interface CreateWalletDto {
  userId?: string;
  playerId?: string;
  currency?: string;
}

/**
 * Data transfer object for triggering wallet reconciliation.
 */
export interface ReconcileWalletDto {
  referencedTransactions?: string[];
}

/**
 * REST controller exposing endpoints for wallet management, state queries,
 * financial ledger inspection, and balance reconciliation.
 */
@Controller("wallets")
export class WalletController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
  ) {}

  /**
   * Creates an active wallet for a given player and currency.
   *
   * @param dto - Wallet creation payload containing player identifier and currency.
   * @returns Newly created wallet aggregate representation.
   * @throws HttpException with 400 Bad Request if neither userId nor playerId is provided.
   * @throws HttpException with 404 Not Found if referenced dependencies are missing.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() dto: CreateWalletDto) {
    const targetUserId = dto.userId || dto.playerId;
    if (!targetUserId) {
      throw new HttpException(
        { message: "Either userId or playerId must be provided." },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const wallet = await this.createWalletUseCase.execute(
        targetUserId,
        dto.currency,
      );
      return wallet;
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new HttpException(
          { message: "Wallet not found." },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves a wallet by its unique aggregate identifier.
   *
   * @param id - Unique wallet aggregate identifier.
   * @returns Wallet state details including balance and currency.
   * @throws HttpException with 404 Not Found if wallet does not exist.
   */
  @Get(":id")
  @HttpCode(HttpStatus.OK)
  async getWalletById(@Param("id") id: string) {
    try {
      const wallet = await this.getWalletUseCase.execute(id);
      return wallet;
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new HttpException(
          { message: "Wallet not found." },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  /**
   * Performs an authoritative reconciliation between aggregate balance and financial ledger.
   *
   * @param walletId - Unique wallet identifier to reconcile.
   * @param dto - Reconciliation options and referenced transaction identifiers.
   * @returns Detailed reconciliation report indicating mathematical balance balance match.
   * @throws HttpException with 404 Not Found if wallet does not exist.
   */
  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(
    @Param("walletId") walletId: string,
    @Body() dto: ReconcileWalletDto,
  ) {
    try {
      const result = await this.reconcileWalletUseCase.execute(
        walletId,
        dto.referencedTransactions,
      );
      return {
        success: true,
        message: "Wallet reconciliation completed successfully.",
        details: result,
      };
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new HttpException(
          { message: "Wallet not found." },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves paginated financial ledger audit entries for a specified wallet.
   *
   * @param walletId - Unique wallet identifier whose ledger entries are queried.
   * @param cursor - Pagination cursor timestamp.
   * @param limit - Maximum number of ledger entries to return.
   * @returns Array of immutable double-entry ledger records.
   * @throws HttpException with 404 Not Found if wallet does not exist.
   */
  @Get(":walletId/ledger")
  @HttpCode(HttpStatus.OK)
  async getWalletLedger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: number | string,
  ) {
    try {
      const parsedLimit = limit !== undefined && limit !== null && limit !== "" ? Number(limit) : 50;
      const ledgerEntries = await this.getWalletLedgerUseCase.execute(
        walletId,
        cursor,
        parsedLimit,
      );
      return ledgerEntries;
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new HttpException(
          { message: "Wallet not found." },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
