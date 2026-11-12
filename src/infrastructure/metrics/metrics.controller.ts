import { Controller, Get, Header, HttpCode, HttpStatus, Inject } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

/**
 * Controller exposing Prometheus/OpenMetrics telemetry scrapable endpoint.
 */
@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(MetricsService)
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Scrapes and returns real-time metrics in standard Prometheus exposition text format.
   *
   * @returns Raw Prometheus metrics string.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  getMetrics(): string {
    return this.metricsService.toPrometheus();
  }
}
