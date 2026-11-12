import { Migration } from "@mikro-orm/migrations";

export class Migration20261110000001_InitialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`set names 'utf8';`);

    this.addSql(`
      create table if not exists "wallets" (
        "id" varchar(36) not null,
        "player_id" varchar(36) not null,
        "currency" varchar(3) not null,
        "balance_cents" bigint not null default 0,
        "version" int not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "wallets_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "wallets" add constraint "uk_wallets_player_currency" unique ("player_id", "currency");
    `);
    this.addSql(`
      alter table "wallets" add constraint "check_positive_balance" check (balance_cents >= 0);
    `);

    this.addSql(`
      create table if not exists "wager_transactions" (
        "id" varchar(36) not null,
        "provider_id" varchar(50) not null,
        "external_transaction_id" varchar(100) not null,
        "idempotency_key" varchar(150) not null,
        "payload_hash" varchar(64) not null,
        "wallet_id" varchar(36) not null references "wallets"("id"),
        "player_id" varchar(36) not null,
        "round_id" varchar(100) not null,
        "game_id" varchar(100) not null,
        "kind" varchar(20) not null,
        "amount_cents" bigint not null,
        "currency" varchar(3) not null,
        "status" varchar(30) not null,
        "reference_external_transaction_id" varchar(100) null,
        "reference_transaction_id" varchar(36) null,
        "failure_code" varchar(50) null,
        "created_at" timestamptz not null default now(),
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "idx_wager_tx_pending_reference" on "wager_transactions" ("created_at");
    `);
    this.addSql(`
      alter table "wager_transactions" add constraint "uk_wager_provider_external" unique ("provider_id", "external_transaction_id");
    `);
    this.addSql(`
      alter table "wager_transactions" add constraint "uk_wager_idempotency_key" unique ("idempotency_key");
    `);

    this.addSql(`
      create table if not exists "wallet_ledger_entries" (
        "id" varchar(36) not null,
        "wallet_id" varchar(36) not null references "wallets"("id"),
        "transaction_id" varchar(36) not null references "wager_transactions"("id"),
        "direction" varchar(10) not null,
        "amount_cents" bigint not null,
        "currency" varchar(3) not null,
        "balance_before_cents" bigint not null,
        "balance_after_cents" bigint not null,
        "created_at" timestamptz not null default now(),
        constraint "wallet_ledger_entries_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "wallet_ledger_entries" add constraint "check_ledger_equation" check (
        ((direction = 'DEBIT' and balance_before_cents - amount_cents = balance_after_cents) or
         (direction = 'CREDIT' and balance_before_cents + amount_cents = balance_after_cents))
      );
    `);

    this.addSql(`
      create table if not exists "inbox_messages" (
        "message_id" varchar(100) not null,
        "consumer_name" varchar(100) not null,
        "payload_hash" varchar(64) not null,
        "received_at" timestamptz not null default now(),
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("message_id", "consumer_name")
      );
    `);

    this.addSql(`
      create table if not exists "outbox_messages" (
        "id" varchar(36) not null,
        "aggregate_id" varchar(36) not null,
        "event_type" varchar(100) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null default now(),
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "idx_outbox_pending_skip_locked" on "outbox_messages" ("occurred_at");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
  }
}
