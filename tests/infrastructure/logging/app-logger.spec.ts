import { describe, it, expect, beforeEach } from "bun:test";
import { AppLogger, type LogEntry } from "../../../src/infrastructure/logging/app-logger.service";
import { RequestContextService } from "../../../src/infrastructure/logging/request-context.service";
import { sanitizePayload } from "../../../src/infrastructure/logging/payload-sanitizer";
import { CorrelationIdMiddleware } from "../../../src/infrastructure/logging/correlation-id.middleware";

describe("AppLogger & Logging Estruturado em JSON", () => {
  let logger: AppLogger;
  let contextService: RequestContextService;
  let loggedEntries: LogEntry[];

  beforeEach(() => {
    contextService = new RequestContextService();
    logger = new AppLogger("TestContext", contextService);
    loggedEntries = [];

    logger.setWriter((line: string) => {
      const parsed = JSON.parse(line) as LogEntry;
      loggedEntries.push(parsed);
    });
  });

  describe("Formato e Chaves Obrigatórias do Log", () => {
    it("deve emitir logs em JSON puro contendo todas as chaves obrigatórias de contexto", () => {
      contextService.run(
        {
          correlationId: "corr-123",
          messageId: "msg-456",
          transactionId: "tx-789",
          walletId: "wal-001",
          providerId: "prov-a",
        },
        () => {
          logger.log("Operação executada com sucesso", { details: "teste" });
        },
      );

      expect(loggedEntries.length).toBe(1);
      const entry = loggedEntries[0]!;

      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      expect(entry.level).toBe("info");
      expect(entry.message).toBe("Operação executada com sucesso");
      expect(entry.context).toBe("TestContext");

      // Chaves obrigatórias conforme Seção 12
      expect(entry.correlationId).toBe("corr-123");
      expect(entry.messageId).toBe("msg-456");
      expect(entry.transactionId).toBe("tx-789");
      expect(entry.walletId).toBe("wal-001");
      expect(entry.providerId).toBe("prov-a");
      expect(entry.data).toEqual({ details: "teste" });
    });

    it("deve preencher as chaves de contexto como null caso não estejam presentes", () => {
      logger.warn("Aviso sem contexto prévio");

      expect(loggedEntries.length).toBe(1);
      const entry = loggedEntries[0]!;

      expect(entry.level).toBe("warn");
      expect(entry.correlationId).toBeNull();
      expect(entry.messageId).toBeNull();
      expect(entry.transactionId).toBeNull();
      expect(entry.walletId).toBeNull();
      expect(entry.providerId).toBeNull();
    });

    it("deve incluir stack trace em caso de log de erro", () => {
      const error = new Error("Falha de conexão com PostgreSQL");
      logger.error(error);

      expect(loggedEntries.length).toBe(1);
      const entry = loggedEntries[0]!;

      expect(entry.level).toBe("error");
      expect(entry.message).toBe("Falha de conexão com PostgreSQL");
      expect(entry.stack).toBeDefined();
      expect(entry.stack).toContain("Falha de conexão com PostgreSQL");
    });
  });

  describe("Sanitização e Proteção contra Vazamento de Dados Sensíveis", () => {
    it("deve mascarar campos sensíveis como senhas, tokens, secrets e chaves privadas", () => {
      const sensitiveData = {
        username: "operador",
        password: "super-secret-password-123",
        token: "bearer-jwt-token-xyz",
        apiKey: "ak_live_998877665544",
        secretKey: "sk_live_11223344",
        authorization: "Bearer secret-jwt",
        creditCard: "4111-2222-3333-4444",
        cvv: "123",
      };

      const sanitized = sanitizePayload(sensitiveData) as Record<string, unknown>;

      expect(sanitized.username).toBe("operador");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.secretKey).toBe("[REDACTED]");
      expect(sanitized.authorization).toBe("[REDACTED]");
      expect(sanitized.creditCard).toBe("[REDACTED]");
      expect(sanitized.cvv).toBe("[REDACTED]");
    });

    it("deve mascarar recursivamente campos aninhados e em arrays", () => {
      const nested = {
        account: {
          id: "acc-1",
          credentials: {
            authSecret: "nested-secret-value",
          },
        },
        payloadList: [
          { token: "tok-1", name: "item-1" },
          { privateKey: "pem-content", name: "item-2" },
        ],
      };

      logger.log("Tentativa de login", nested);

      expect(loggedEntries.length).toBe(1);
      const data = loggedEntries[0]!.data as any;

      expect(data.account.credentials.authSecret).toBe("[REDACTED]");
      expect(data.payloadList[0].token).toBe("[REDACTED]");
      expect(data.payloadList[0].name).toBe("item-1");
      expect(data.payloadList[1].privateKey).toBe("[REDACTED]");
    });
  });

  describe("CorrelationIdMiddleware", () => {
    it("deve capturar x-correlation-id existente do request e propagar no header e contexto", () => {
      const middleware = new CorrelationIdMiddleware(contextService);
      const req = { headers: { "x-correlation-id": "req-custom-correlation-id" } };
      let headerSet: { name: string; value: string } | undefined;
      const res = {
        setHeader: (name: string, value: string) => {
          headerSet = { name, value };
        },
      };

      let capturedInNext: string | null = null;
      middleware.use(req, res, () => {
        capturedInNext = contextService.getCorrelationId();
      });

      expect(headerSet).toEqual({
        name: "x-correlation-id",
        value: "req-custom-correlation-id",
      });
      expect(capturedInNext as string | null).toBe("req-custom-correlation-id");
    });

    it("deve gerar um novo correlationId caso não fornecido na requisição", () => {
      const middleware = new CorrelationIdMiddleware(contextService);
      const req = { headers: {} };
      let headerSet: { name: string; value: string } | undefined;
      const res = {
        setHeader: (name: string, value: string) => {
          headerSet = { name, value };
        },
      };

      let capturedInNext: string | null = null;
      middleware.use(req, res, () => {
        capturedInNext = contextService.getCorrelationId();
      });

      expect(headerSet?.name).toBe("x-correlation-id");
      expect(headerSet?.value).toBeDefined();
      expect(capturedInNext as string | null).toBe(headerSet?.value ?? null);
    });
  });
});
