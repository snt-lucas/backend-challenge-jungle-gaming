import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { ProcessWagerTransactionUseCase } from "@application/use-cases/process-wager-transaction.use-case";
import { ProcessWagerTransactionDto } from "@application/dtos/process-wager-transaction.dto";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "@application/errors";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "@application/ports/wager-transaction.repository.port";
import { RequestContextService } from "../../../infrastructure/logging/request-context.service";
import { MetricsService } from "../../../infrastructure/metrics/metrics.service";

/**
 * Controller handling HTTP requests for wagering transactions.
 * Provides endpoints for transaction submission and queries by internal and provider IDs.
 */
@Controller()
export class WagerTransactionController {
  constructor(
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
  ) {}

  /**
   * Processes a wager transaction under the provided idempotency key.
   */
  @Post("wagering/transactions")
  @HttpCode(HttpStatus.CREATED)
  async createWagerTransaction(
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: ProcessWagerTransactionDto,
  ) {
    const startTime = performance.now();
    const contextStore = RequestContextService.current();
    if (contextStore) {
      contextStore.correlationId = contextStore.correlationId ?? idempotencyKey;
      contextStore.providerId = dto?.providerId;
      contextStore.walletId = dto?.walletId;
    }

    try {
      const result = await this.processWagerTransactionUseCase.execute({
        idempotencyKey,
        providerId: dto.providerId,
        wagererId: dto.wagererId,
        walletId: dto.walletId,
        externalTransactionId: dto.externalTransactionId,
        amount: dto.amount,
        currency: dto.currency,
        kind: dto.kind,
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
        metadata: dto.metadata,
      });

      const durationMs = performance.now() - startTime;
      MetricsService.getInstance().recordTransactionDuration(durationMs);

      if (contextStore) {
        contextStore.transactionId = result.transactionId;
      }

      if (result.idempotentReplay) {
        MetricsService.getInstance().incrementIdempotencyDuplicates();
      }

      MetricsService.getInstance().incrementTransactionsTotal("PROCESSED");

      return {
        transactionId: result.transactionId,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      MetricsService.getInstance().recordTransactionDuration(durationMs);

      if (error instanceof IdempotencyConflictError) {
        MetricsService.getInstance().incrementIdempotencyDuplicates();
        MetricsService.getInstance().incrementTransactionsTotal("REJECTED");
        throw new HttpException(
          {
            message: error.message,
            statusCode: HttpStatus.CONFLICT,
            error: "Conflict",
          },
          HttpStatus.CONFLICT,
        );
      }

      if (error instanceof WalletNotFoundError) {
        MetricsService.getInstance().incrementTransactionsTotal("REJECTED");
        throw new HttpException(
          {
            message: error.message,
            statusCode: HttpStatus.NOT_FOUND,
            error: "Not Found",
          },
          HttpStatus.NOT_FOUND,
        );
      }

      MetricsService.getInstance().incrementTransactionsTotal("FAILED");
      throw error;
    }
  }

  /**
   * Retrieves a wager transaction by its internal UUID.
   */
  @Get("wagering/transactions/:transactionId")
  @HttpCode(HttpStatus.OK)
  async getWagerTransactionById(@Param("transactionId") transactionId: string) {
    const transaction = await this.wagerTransactionRepository.findById(transactionId);
    if (!transaction) {
      throw new HttpException(
        {
          message: `Wager transaction with ID ${transactionId} not found`,
          statusCode: HttpStatus.NOT_FOUND,
          error: "Not Found",
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return transaction;
  }

  /**
   * Retrieves a wager transaction by provider identifier and external transaction ID.
   */
  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  @HttpCode(HttpStatus.OK)
  async getWagerTransactionByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const transaction = await this.wagerTransactionRepository.findByExternalId(
      providerId,
      externalTransactionId,
    );
    if (!transaction) {
      throw new HttpException(
        {
          message: `Wager transaction with external ID ${externalTransactionId} for provider ${providerId} not found`,
          statusCode: HttpStatus.NOT_FOUND,
          error: "Not Found",
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return transaction;
  }
}
