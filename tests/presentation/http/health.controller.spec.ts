import { describe, it, expect, beforeEach, mock } from "bun:test";
import { HealthController } from "../../../src/presentation/http/controllers/health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  describe("GET /health/live", () => {
    it("deve retornar 200 OK com status UP para a verificacao de vivacidade (liveness)", async () => {
      const response = await controller.getLiveness();
      expect(response).toEqual({ status: "UP", timestamp: expect.any(String) });
    });
  });

  describe("GET /health/ready", () => {
    it("deve retornar 200 OK com status UP detalhado para a verificacao de prontidao (readiness)", async () => {
      const dbMock = { query: mock(() => Promise.resolve([{ "?column?": 1 }])) };
      const sqsMock = { send: mock(() => Promise.resolve({ QueueUrls: [] })) };
      const readyController = new HealthController(dbMock as any, sqsMock as any);

      const resMock = { status: mock() };
      const response = await readyController.getReadiness(resMock as any);

      expect(response).toEqual({
        status: "UP",
        database: "UP",
        messaging: "UP",
        timestamp: expect.any(String),
      });
      expect(resMock.status).not.toHaveBeenCalled();
    });

    it("deve retornar status DOWN e HTTP 503 quando a conexao com o banco falhar", async () => {
      const failingDb = {
        query: () => Promise.reject(new Error("Connection timeout")),
      };
      const failingController = new HealthController(failingDb as any);

      const resMock = { status: mock() };
      const response = await failingController.getReadiness(resMock as any);

      expect(response.status).toBe("DOWN");
      expect(response.database).toBe("DOWN");
      expect(response.messaging).toBe("UP");
      expect(response.timestamp).toBeDefined();
      expect(resMock.status).toHaveBeenCalledWith(503);
    });

    it("deve retornar status DOWN e HTTP 503 quando a comunicacao com a mensageria falhar", async () => {
      const healthyDb = { query: () => Promise.resolve([{ "?column?": 1 }]) };
      const failingSqs = {
        send: () => Promise.reject(new Error("LocalStack unreachable")),
      };
      const failingController = new HealthController(healthyDb as any, failingSqs as any);

      const resMock = { status: mock() };
      const response = await failingController.getReadiness(resMock as any);

      expect(response.status).toBe("DOWN");
      expect(response.database).toBe("UP");
      expect(response.messaging).toBe("DOWN");
      expect(response.timestamp).toBeDefined();
      expect(resMock.status).toHaveBeenCalledWith(503);
    });
  });
});
