import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "bun:test";
import { Money } from "../../src/domain/value-objects/money.vo";

export interface LedgerInvariantResult {
  isBalanced: boolean;
  walletBalance: Money;
  reconstructedBalance: Money;
  sumDebits: Money;
  sumCredits: Money;
  entryCount: number;
}

export class TestDatabaseHelper {
  private static instance: TestDatabaseHelper;
  public sql: SQL;
  private isAvailable: boolean | null = null;

  private constructor() {
    const connectionUri =
      process.env.DATABASE_URL ||
      "postgres://postgres:postgrespassword@localhost:5432/wagering";
    this.sql = new SQL(connectionUri);
  }

  public static getInstance(): TestDatabaseHelper {
    if (!TestDatabaseHelper.instance) {
      TestDatabaseHelper.instance = new TestDatabaseHelper();
    }
    return TestDatabaseHelper.instance;
  }

  /**
   * Verifica se o banco PostgreSQL real está ativo e acessível.
   */
  public async checkAvailability(): Promise<boolean> {
    if (this.isAvailable !== null) return this.isAvailable;
    try {
      const result = await Promise.race([
        this.sql`SELECT 1 as alive`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database connection timeout")), 1500),
        ),
      ]);
      this.isAvailable = Array.isArray(result) && result.length > 0;
    } catch {
      this.isAvailable = false;
    }
    return this.isAvailable;
  }

  /**
   * Executa a migration inicial no PostgreSQL real.
   */
  public async runMigrations(): Promise<void> {
    const migrationPath = resolve(
      process.cwd(),
      "src/infrastructure/database/migrations/001_initial_schema.sql",
    );
    const sqlScript = readFileSync(migrationPath, "utf-8");
    await this.sql.unsafe(sqlScript);
  }

  /**
   * Executa TRUNCATE CASCADE em todas as tabelas para isolamento determinístico.
   */
  public async cleanDatabase(): Promise<void> {
    await this.sql.unsafe(`
      TRUNCATE TABLE 
        wallet_ledger_entries,
        wager_transactions,
        wallets,
        inbox_messages,
        outbox_messages
      CASCADE;
    `);
  }

  /**
   * Validador contábil reutilizável (Invariante Matemática Obrigatória do Desafio):
   * Wallet.balance === Saldo reconstruído pelo somatório do Ledger:
   * (initialBalance - sum(DEBIT) + sum(CREDIT)).
   */
  public async assertLedgerInvariant(
    walletId: string,
    expectedInitialBalance?: Money,
  ): Promise<LedgerInvariantResult> {
    const [walletRow] = await this.sql`
      SELECT id, currency, balance_cents, version
      FROM wallets
      WHERE id = ${walletId}
    `;

    if (!walletRow) {
      throw new Error(`Wallet com ID [${walletId}] não encontrada no PostgreSQL`);
    }

    const currency = walletRow.currency as string;
    const currentWalletBalance = Money.fromCents(
      BigInt(walletRow.balance_cents),
      currency,
    );

    const ledgerRows = (await this.sql`
      SELECT id, direction, amount_cents, currency, balance_before_cents, balance_after_cents, created_at
      FROM wallet_ledger_entries
      WHERE wallet_id = ${walletId}
      ORDER BY created_at ASC
    `) as Array<{
      id: string;
      direction: string;
      amount_cents: string | number | bigint;
      currency: string;
      balance_before_cents: string | number | bigint;
      balance_after_cents: string | number | bigint;
    }>;

    let sumDebits = Money.zero(currency);
    let sumCredits = Money.zero(currency);

    // Valida cada lançamento individualmente contra a equação contábil
    for (const entry of ledgerRows) {
      const entryMoney = Money.fromCents(BigInt(entry.amount_cents), currency);
      const beforeMoney = Money.fromCents(BigInt(entry.balance_before_cents), currency);
      const afterMoney = Money.fromCents(BigInt(entry.balance_after_cents), currency);

      if (entry.direction === "DEBIT") {
        sumDebits = sumDebits.add(entryMoney);
        expect(beforeMoney.subtract(entryMoney).cents).toBe(afterMoney.cents);
      } else if (entry.direction === "CREDIT") {
        sumCredits = sumCredits.add(entryMoney);
        expect(beforeMoney.add(entryMoney).cents).toBe(afterMoney.cents);
      }
    }

    // Determina o saldo inicial
    let initialBalance: Money;
    if (expectedInitialBalance) {
      initialBalance = expectedInitialBalance;
    } else if (ledgerRows.length > 0) {
      initialBalance = Money.fromCents(
        BigInt(ledgerRows[0]!.balance_before_cents),
        currency,
      );
    } else {
      initialBalance = currentWalletBalance;
    }

    const reconstructedBalance = initialBalance
      .subtract(sumDebits)
      .add(sumCredits);

    const isBalanced = currentWalletBalance.equals(reconstructedBalance);

    // Assert final obrigatório
    expect(isBalanced).toBe(true);
    expect(currentWalletBalance.amount).toBe(reconstructedBalance.amount);

    return {
      isBalanced,
      walletBalance: currentWalletBalance,
      reconstructedBalance,
      sumDebits,
      sumCredits,
      entryCount: ledgerRows.length,
    };
  }

  public async close(): Promise<void> {
    await this.sql.close();
  }
}
