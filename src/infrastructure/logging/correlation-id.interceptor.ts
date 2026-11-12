import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { RequestContextService } from "./request-context.service";

/**
 * Interceptor extracting or generating a unique correlation ID for each incoming HTTP request,
 * binding it to the active RequestContext and propagating it in HTTP response headers.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly requestContextService?: RequestContextService) {}

  /**
   * Intercepts execution to establish the correlation context around downstream route handling.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const rawHeader = req?.headers?.["x-correlation-id"] ?? req?.headers?.["correlation-id"];
    const correlationId =
      (typeof rawHeader === "string" && rawHeader.trim().length > 0
        ? rawHeader.trim()
        : null) ?? randomUUID();

    if (res && typeof res.setHeader === "function") {
      res.setHeader("x-correlation-id", correlationId);
    }

    const runner = this.requestContextService?.run.bind(this.requestContextService) ?? RequestContextService.run;

    return new Observable((subscriber) => {
      runner({ correlationId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
