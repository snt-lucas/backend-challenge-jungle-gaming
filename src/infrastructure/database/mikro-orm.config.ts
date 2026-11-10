import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, PostgreSqlDriver } from "@mikro-orm/postgresql";
import {
  InboxMessageSchema,
  OutboxMessageSchema,
  WagerTransactionSchema,
  WalletLedgerEntrySchema,
  WalletSchema,
} from "./schemas";

export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgrespassword@localhost:5432/wagering",
  entities: [
    WalletSchema,
    WagerTransactionSchema,
    WalletLedgerEntrySchema,
    InboxMessageSchema,
    OutboxMessageSchema,
  ],
  migrations: {
    path: "src/infrastructure/database/migrations",
    pathTs: "src/infrastructure/database/migrations",
    tableName: "mikro_orm_migrations",
    transactional: true,
    allOrNothing: true,
    dropTables: false,
    safe: true,
    emit: "ts",
  },
  extensions: [Migrator],
  debug: process.env.NODE_ENV === "development" || process.env.DEBUG === "true",
});
