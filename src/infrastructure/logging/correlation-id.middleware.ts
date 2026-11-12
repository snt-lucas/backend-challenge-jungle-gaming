import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContextService } from "./request-context.service";

/**
 * Middleware ensuring every incoming HTTP request carries a correlation ID in headers and RequestContext.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService?: RequestContextService) {}

  /**
   * Captures or assigns x-correlation-id header and binds execution inside RequestContext.
   */
  use(req: any, res: any, next: (error?: unknown) => void): void {
    const rawHeader = req.headers?.["x-correlation-id"] ?? req.headers?.["correlation-id"];
    const correlationId =
      (typeof rawHeader === "string" && rawHeader.trim().length > 0
        ? rawHeader.trim()
        : null) ?? randomUUID();

    if (res && typeof res.setHeader === "function") {
      res.setHeader("x-correlation-id", correlationId);
    }

    const runner = this.requestContextService?.run.bind(this.requestContextService) ?? RequestContextService.run;

    runner({ correlationId }, () => {
      next();
    });
  }
}
