import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export class PostgresTestHelper {
  private static instance: PostgresTestHelper;
  public sql: SQL;
  private isAvailable: boolean | null = null;

  private constructor() {
    const connectionUri =
      process.env.DATABASE_URL ||
      "postgres://postgres:postgrespassword@localhost:5432/wagering";
    this.sql = new SQL(connectionUri);
  }

  public static getInstance(): PostgresTestHelper {
    if (!PostgresTestHelper.instance) {
      PostgresTestHelper.instance = new PostgresTestHelper();
    }
    return PostgresTestHelper.instance;
  }

  public async checkAvailability(): Promise<boolean> {
    if (this.isAvailable !== null) return this.isAvailable;
    try {
      const result = await Promise.race([
        this.sql`SELECT 1 as alive`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 1500),
        ),
      ]);
      this.isAvailable = Array.isArray(result) && result.length > 0;
    } catch {
      this.isAvailable = false;
    }
    return this.isAvailable;
  }

  public async runMigrations(): Promise<void> {
    const migrationPath = resolve(
      process.cwd(),
      "src/infrastructure/database/migrations/001_initial_schema.sql",
    );
    const sqlScript = readFileSync(migrationPath, "utf-8");
    await this.sql.unsafe(sqlScript);
  }

  public async truncateAll(): Promise<void> {
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

  public async close(): Promise<void> {
    await this.sql.close();
  }
}
