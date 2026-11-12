import { describe, it, expect, beforeEach } from "bun:test";
import { RequestContextService, type RequestContext } from "../../../src/infrastructure/logging/request-context.service";

describe("RequestContextService (AsyncLocalStorage)", () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it("deve propagar o contexto corretamente dentro da execução assíncrona", async () => {
    const context: RequestContext = {
      correlationId: "corr-123",
      messageId: "msg-456",
      transactionId: "tx-789",
      walletId: "wal-001",
      providerId: "prov-a",
    };

    await service.run(context, async () => {
      expect(service.getContext()).toEqual(context);
      expect(service.getCorrelationId()).toBe("corr-123");
      expect(service.getMessageId()).toBe("msg-456");
      expect(service.getTransactionId()).toBe("tx-789");
      expect(service.getWalletId()).toBe("wal-001");
      expect(service.getProviderId()).toBe("prov-a");

      // Simulação de chamada assíncrona aninhada
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(service.getCorrelationId()).toBe("corr-123");
    });

    // Fora do escopo run, o contexto deve ser undefined/vazio
    expect(service.getContext()).toBeUndefined();
    expect(service.getCorrelationId()).toBeNull();
  });

  it("deve isolar contextos em execuções concorrentes sem vazamento entre requisições", async () => {
    const taskA = service.run(
      { correlationId: "req-A", transactionId: "tx-A" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(service.getCorrelationId()).toBe("req-A");
        expect(service.getTransactionId()).toBe("tx-A");
        return service.getCorrelationId();
      },
    );

    const taskB = service.run(
      { correlationId: "req-B", transactionId: "tx-B" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(service.getCorrelationId()).toBe("req-B");
        expect(service.getTransactionId()).toBe("tx-B");
        return service.getCorrelationId();
      },
    );

    const [resA, resB] = await Promise.all([taskA, taskB]);
    expect(resA).toBe("req-A");
    expect(resB).toBe("req-B");
  });

  it("deve permitir atualizar ou adicionar chaves dinamicamente dentro do contexto ativo", async () => {
    await service.run({ correlationId: "initial-corr" }, async () => {
      expect(service.getCorrelationId()).toBe("initial-corr");
      expect(service.getTransactionId()).toBeNull();

      service.set("transactionId", "tx-dynamic");
      expect(service.getTransactionId()).toBe("tx-dynamic");

      service.setContext({ walletId: "wal-999", providerId: "prov-xyz" });
      expect(service.getWalletId()).toBe("wal-999");
      expect(service.getProviderId()).toBe("prov-xyz");
    });
  });
});
