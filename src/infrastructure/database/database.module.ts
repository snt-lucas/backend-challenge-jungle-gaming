import { Global, Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { EntityManager } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./mikro-orm.config";
import {
  InboxMessageSchema,
  OutboxMessageSchema,
  WagerTransactionSchema,
  WalletLedgerEntrySchema,
  WalletSchema,
} from "./schemas";
import {
  MikroOrmWalletRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerRepository,
  MikroOrmInboxRepository,
  MikroOrmUnitOfWork,
} from "./repositories";
import { WALLET_REPOSITORY_PORT } from "../../application/ports/wallet.repository.port";
import { WAGER_TRANSACTION_REPOSITORY_PORT } from "../../application/ports/wager-transaction.repository.port";
import { WALLET_LEDGER_REPOSITORY_PORT } from "../../application/ports/wallet-ledger.repository.port";
import { INBOX_REPOSITORY_PORT } from "../../application/ports/inbox.repository.port";
import { UNIT_OF_WORK_PORT } from "../../application/ports/unit-of-work.port";
import { PESSIMISTIC_LOCK_PORT } from "../../application/ports/pessimistic-lock.port";
import { MemoryPessimisticLockAdapter } from "../locking/memory-pessimistic-lock.adapter";
import { DatabaseConnection } from "./database-connection";

@Global()
@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    MikroOrmModule.forFeature([
      WalletSchema,
      WagerTransactionSchema,
      WalletLedgerEntrySchema,
      InboxMessageSchema,
      OutboxMessageSchema,
    ]),
  ],
  providers: [
    MikroOrmWalletRepository,
    MikroOrmWagerTransactionRepository,
    MikroOrmWalletLedgerRepository,
    MikroOrmInboxRepository,
    MikroOrmUnitOfWork,
    MemoryPessimisticLockAdapter,
    {
      provide: WALLET_REPOSITORY_PORT,
      useClass: MikroOrmWalletRepository,
    },
    {
      provide: WAGER_TRANSACTION_REPOSITORY_PORT,
      useClass: MikroOrmWagerTransactionRepository,
    },
    {
      provide: WALLET_LEDGER_REPOSITORY_PORT,
      useClass: MikroOrmWalletLedgerRepository,
    },
    {
      provide: INBOX_REPOSITORY_PORT,
      useClass: MikroOrmInboxRepository,
    },
    {
      provide: UNIT_OF_WORK_PORT,
      useClass: MikroOrmUnitOfWork,
    },
    {
      provide: PESSIMISTIC_LOCK_PORT,
      useClass: MemoryPessimisticLockAdapter,
    },
    {
      provide: "DATABASE_CONNECTION",
      useFactory: (em: EntityManager) => {
        return {
          execute: async (query: string) => {
            return await em.getConnection().execute(query);
          },
          query: async (query: string) => {
            return await em.getConnection().execute(query);
          },
        };
      },
      inject: [EntityManager],
    },
    {
      provide: DatabaseConnection,
      useValue: DatabaseConnection,
    },
  ],
  exports: [
    MikroOrmModule,
    WALLET_REPOSITORY_PORT,
    WAGER_TRANSACTION_REPOSITORY_PORT,
    WALLET_LEDGER_REPOSITORY_PORT,
    INBOX_REPOSITORY_PORT,
    UNIT_OF_WORK_PORT,
    PESSIMISTIC_LOCK_PORT,
    "DATABASE_CONNECTION",
    DatabaseConnection,
    MikroOrmWalletRepository,
    MikroOrmWagerTransactionRepository,
    MikroOrmWalletLedgerRepository,
    MikroOrmInboxRepository,
    MikroOrmUnitOfWork,
  ],
})
export class DatabaseModule {}
