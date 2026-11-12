import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AppLogger } from "./infrastructure/logging/app-logger.service";
import { CorrelationIdMiddleware } from "./infrastructure/logging/correlation-id.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const correlationMiddleware = app.get(CorrelationIdMiddleware);
  app.use((req: any, res: any, next: any) => {
    correlationMiddleware.use(req, res, next);
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Backend Challenge API em execução na porta ${port}`);
}

bootstrap();
