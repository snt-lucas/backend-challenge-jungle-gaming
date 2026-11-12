import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { UnitOfWorkPort } from "../../../application/ports/unit-of-work.port";

/**
 * MikroORM-based PostgreSQL implementation of the UnitOfWork port,
 * coordinating ACID database transactions across multiple repository operations.
 */
@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly em: EntityManager) {}

  /**
   * Executes an asynchronous work callback inside an isolated database transaction.
   * Automatically commits upon completion or aborts with ROLLBACK on thrown exception.
   *
   * @param work - Callback encapsulating operations to execute transactionally.
   * @returns Result yielded by the work callback.
   */
  async execute<T>(work: () => Promise<T>): Promise<T> {
    return await this.em.transactional(async () => {
      return await work();
    });
  }
}
