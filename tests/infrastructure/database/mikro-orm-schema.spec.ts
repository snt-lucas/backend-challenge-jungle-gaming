import { MikroORM } from "@mikro-orm/core";
import { describe, expect, it } from "bun:test";
import mikroOrmConfig from "../../../src/infrastructure/database/mikro-orm.config";
import { Migration20261110000001_InitialSchema } from "../../../src/infrastructure/database/migrations/Migration20261110000001_InitialSchema";

describe("MikroORM Entity Schemas & Migrations Specification", () => {
  it("deve carregar todos os 5 EntitySchemas com constraints nativas de banco", async () => {
    const orm = await MikroORM.init({
      ...mikroOrmConfig,
      connect: false,
    } as any);

    const ddl = await orm.schema.getCreateSchemaSQL();

    // 1. Validações da tabela wallets
    expect(ddl).toContain('create table "wallets"');
    expect(ddl).toContain("check_positive_balance");
    expect(ddl).toContain("uk_wallets_player_currency");

    // 2. Validações da tabela wager_transactions
    expect(ddl).toContain('create table "wager_transactions"');
    expect(ddl).toContain("uk_wager_provider_external");
    expect(ddl).toContain("uk_wager_idempotency_key");
    expect(ddl).toContain("idx_wager_tx_pending_reference");

    // 3. Validações da tabela wallet_ledger_entries
    expect(ddl).toContain('create table "wallet_ledger_entries"');
    expect(ddl).toContain("check_ledger_equation");

    // 4. Validações de inbox_messages e outbox_messages
    expect(ddl).toContain('create table "inbox_messages"');
    expect(ddl).toContain('create table "outbox_messages"');
    expect(ddl).toContain("idx_outbox_pending_skip_locked");

    await orm.close();
  });

  it("deve executar up() e down() da migration inicial gerando SQL consistente", async () => {
    const executedSql: string[] = [];
    const mockDriver = {
      // Mock driver methods for migration testing
    };

    const migration = new Migration20261110000001_InitialSchema(
      mockDriver as any,
      mikroOrmConfig as any,
    );

    // Mock do método addSql
    migration.addSql = (sql: string) => {
      executedSql.push(sql);
    };

    await migration.up();
    expect(executedSql.length).toBeGreaterThan(0);
    const upSql = executedSql.join("\n");
    expect(upSql).toContain("wallets");
    expect(upSql).toContain("check_positive_balance");
    expect(upSql).toContain("uk_wallets_player_currency");
    expect(upSql).toContain("wager_transactions");
    expect(upSql).toContain("uk_wager_idempotency_key");

    executedSql.length = 0;
    await migration.down();
    const downSql = executedSql.join("\n");
    expect(downSql).toContain('drop table if exists "wallets" cascade;');
    expect(downSql).toContain(
      'drop table if exists "wager_transactions" cascade;',
    );
  });
});
