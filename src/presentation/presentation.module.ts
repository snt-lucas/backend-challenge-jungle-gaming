import { Module } from "@nestjs/common";
import { HealthController } from "./http/controllers/health.controller";
import { WagerTransactionController } from "./http/controllers/wager-transaction.controller";
import { WalletController } from "./http/controllers/wallet.controller";
import { MetricsController } from "../infrastructure/metrics/metrics.controller";
import { MetricsService } from "../infrastructure/metrics/metrics.service";
import { RequestContextService } from "../infrastructure/logging/request-context.service";
import { AppLogger } from "../infrastructure/logging/app-logger.service";
import { CorrelationIdMiddleware } from "../infrastructure/logging/correlation-id.middleware";
import { CorrelationIdInterceptor } from "../infrastructure/logging/correlation-id.interceptor";
import { CreateWalletUseCase } from "../application/use-cases/create-wallet.use-case";
import { GetWalletUseCase } from "../application/use-cases/get-wallet.use-case";
import { ReconcileWalletUseCase } from "../application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "../application/use-cases/get-wallet-ledger.use-case";
import { ProcessWagerTransactionUseCase } from "../application/use-cases/process-wager-transaction.use-case";
import { DatabaseModule } from "../infrastructure/database/database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    WagerTransactionController,
    WalletController,
    MetricsController,
  ],
  providers: [
    MetricsService,
    RequestContextService,
    AppLogger,
    CorrelationIdMiddleware,
    CorrelationIdInterceptor,
    CreateWalletUseCase,
    GetWalletUseCase,
    ReconcileWalletUseCase,
    GetWalletLedgerUseCase,
    ProcessWagerTransactionUseCase,
  ],
  exports: [
    MetricsService,
    RequestContextService,
    AppLogger,
    CorrelationIdMiddleware,
    CorrelationIdInterceptor,
    CreateWalletUseCase,
    GetWalletUseCase,
    ReconcileWalletUseCase,
    GetWalletLedgerUseCase,
    ProcessWagerTransactionUseCase,
  ],
})
export class PresentationModule {}
