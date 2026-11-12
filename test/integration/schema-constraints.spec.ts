import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresTestHelper } from "../../src/infrastructure/database/postgres-test-helper";

describe("Integração Real PostgreSQL: Restrições de Integridade no Schema (Constraints)", () => {
  const db = PostgresTestHelper.getInstance();
  let isDbAvailable = false;

  beforeAll(async () => {
    isDbAvailable = await db.checkAvailability();
    if (isDbAvailable) {
      await db.runMigrations();
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await db.truncateAll();
    }
  });

  it("deve disparar erro de violação da CONSTRAINT check_positive_balance ao tentar INSERT direto com saldo negativo", async () => {
    if (!isDbAvailable) {
      console.warn("⚠️ [PULADO]: Contêiner PostgreSQL não detectado.");
      return;
    }

    const walletId = randomUUID();
    const playerId = randomUUID();

    let errorCaught: any = null;
    try {
      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', -100, 1)
      `;
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught).toLowerCase()).toContain(
      "check_positive_balance",
    );
  });

  it("deve disparar erro de violação da CONSTRAINT check_positive_balance ao tentar UPDATE direto resultando em saldo negativo", async () => {
    if (!isDbAvailable) return;

    const walletId = randomUUID();
    const playerId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${walletId}, ${playerId}, 'BRL', 500, 1)
    `;

    let errorCaught: any = null;
    try {
      await db.sql`
        UPDATE wallets
        SET balance_cents = -1
        WHERE id = ${walletId}
      `;
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught).toLowerCase()).toContain(
      "check_positive_balance",
    );
  });

  it("deve garantir unicidade de no máximo uma wallet por playerId + currency via CONSTRAINT uk_wallets_player_currency", async () => {
    if (!isDbAvailable) return;

    const playerId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${randomUUID()}, ${playerId}, 'BRL', 1000, 1)
    `;

    let errorCaught: any = null;
    try {
      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${randomUUID()}, ${playerId}, 'BRL', 5000, 1)
      `;
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught).toLowerCase()).toContain(
      "uk_wallets_player_currency",
    );
  });

  it("deve disparar erro se a equação contábil de WalletLedgerEntry for violada no banco", async () => {
    if (!isDbAvailable) return;

    const walletId = randomUUID();
    const playerId = randomUUID();
    const txId = randomUUID();

    await db.sql`
      INSERT INTO wallets (id, player_id, currency, balance_cents, version)
      VALUES (${walletId}, ${playerId}, 'BRL', 1000, 1)
    `;

    await db.sql`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount_cents, currency, status
      ) VALUES (
        ${txId}, 'prov', 'ext-1', 'idemp-1', 'hash',
        ${walletId}, ${playerId}, 'r1', 'g1', 'BET', 500, 'BRL', 'PROCESSED'
      )
    `;

    let errorCaught: any = null;
    try {
      await db.sql`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, direction, amount_cents,
          currency, balance_before_cents, balance_after_cents
        ) VALUES (
          ${randomUUID()}, ${walletId}, ${txId}, 'DEBIT', 500,
          'BRL', 1000, 999
        )
      `;
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught).toLowerCase()).toContain(
      "check_ledger_equation",
    );
  });
});
