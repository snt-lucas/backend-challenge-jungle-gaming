import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import mikroOrmConfig from "./mikro-orm.config";
import {
  InboxMessageSchema,
  OutboxMessageSchema,
  WagerTransactionSchema,
  WalletLedgerEntrySchema,
  WalletSchema,
} from "./schemas";

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
  exports: [MikroOrmModule],
})
export class DatabaseModule {}
