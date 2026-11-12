import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Res,
} from "@nestjs/common";
import { ListQueuesCommand } from "@aws-sdk/client-sqs";

/**
 * Health probe status contract indicating operational readiness or liveness.
 */
export interface HealthResponse {
  status: "UP" | "DOWN";
  timestamp: string;
  database?: "UP" | "DOWN";
  messaging?: "UP" | "DOWN";
}

/**
 * REST controller exposing health probes for container orchestration platforms (Kubernetes / ECS).
 */
@Controller("health")
export class HealthController {
  constructor(
    @Optional() @Inject("DATABASE_CONNECTION") private readonly db?: any,
    @Optional() @Inject("SQS_CLIENT") private readonly sqsClient?: any,
  ) {}

  /**
   * Liveness probe verifying that the application process is running.
   *
   * @returns Health probe status payload with timestamp.
   */
  @Get("live")
  @HttpCode(HttpStatus.OK)
  getLiveness(): HealthResponse {
    return {
      status: "UP",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe verifying active network connectivity to PostgreSQL and AWS SQS brokers.
   *
   * @param res - Express/Fastify response object to customize HTTP status code on degradation.
   * @returns Aggregated readiness report including database and messaging statuses.
   */
  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async getReadiness(
    @Optional() @Res({ passthrough: true }) res?: { status: (code: number) => void },
  ): Promise<HealthResponse> {
    let databaseStatus: "UP" | "DOWN" = "UP";
    let messagingStatus: "UP" | "DOWN" = "UP";

    if (this.db) {
      try {
        if (typeof this.db.query === "function") {
          await Promise.race([
            this.db.query("SELECT 1"),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Database check timeout")), 2000),
            ),
          ]);
        } else if (typeof this.db.execute === "function") {
          await Promise.race([
            this.db.execute("SELECT 1"),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Database check timeout")), 2000),
            ),
          ]);
        }
      } catch {
        databaseStatus = "DOWN";
      }
    }

    if (this.sqsClient) {
      try {
        if (typeof this.sqsClient.send === "function") {
          await Promise.race([
            this.sqsClient.send(new ListQueuesCommand({ MaxResults: 1 })),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Messaging check timeout")), 2000),
            ),
          ]);
        }
      } catch {
        messagingStatus = "DOWN";
      }
    }

    const isHealthy = databaseStatus === "UP" && messagingStatus === "UP";
    const status: "UP" | "DOWN" = isHealthy ? "UP" : "DOWN";

    if (!isHealthy && res && typeof res.status === "function") {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status,
      database: databaseStatus,
      messaging: messagingStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
