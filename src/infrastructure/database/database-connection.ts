import { MikroORM, type Options } from "@mikro-orm/core";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./mikro-orm.config";

/**
 * Singleton database connection manager for PostgreSQL via MikroORM.
 * Used for programmatic initialization, integration test harnesses, and standalone workers.
 */
export class DatabaseConnection {
  private static instance: MikroORM<PostgreSqlDriver> | null = null;

  /**
   * Initializes the PostgreSQL connection or returns the existing instance.
   *
   * @param customConfig - Additional configuration options to override defaults.
   * @returns Active MikroORM instance configured with PostgreSqlDriver.
   */
  static async initialize(
    customConfig?: Partial<Options<PostgreSqlDriver>>,
  ): Promise<MikroORM<PostgreSqlDriver>> {
    if (!this.instance) {
      const mergedConfig = {
        ...mikroOrmConfig,
        ...customConfig,
      } as Options<PostgreSqlDriver>;

      this.instance = await MikroORM.init<PostgreSqlDriver>(mergedConfig);
    }
    return this.instance;
  }

  /**
   * Returns the active MikroORM instance.
   *
   * @returns Active MikroORM instance.
   * @throws Error if connection has not been initialized prior to access.
   */
  static getInstance(): MikroORM<PostgreSqlDriver> {
    if (!this.instance) {
      throw new Error(
        "DatabaseConnection não foi inicializado. Execute DatabaseConnection.initialize() antes de acessar a instância.",
      );
    }
    return this.instance;
  }

  /**
   * Safely closes the active database connection pool.
   */
  static async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close(true);
      this.instance = null;
    }
  }
}
