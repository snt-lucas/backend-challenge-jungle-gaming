import { describe, it, expect, beforeEach, mock } from "bun:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import { WagerTransactionController } from "../../../src/presentation/http/controllers/wager-transaction.controller";
import type { ProcessWagerTransactionUseCase } from "../../../src/application/use-cases/process-wager-transaction.use-case";
import type { WagerTransactionRepositoryPort } from "../../../src/application/ports/wager-transaction.repository.port";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "../../../src/application/errors";
import type { ProcessWagerTransactionDto } from "../../../src/application/dtos/process-wager-transaction.dto";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../src/domain/enums";

describe("WagerTransactionController", () => {
  let controller: WagerTransactionController;
  let processWagerTransactionUseCaseMock: ProcessWagerTransactionUseCase;
  let wagerTransactionRepositoryMock: WagerTransactionRepositoryPort;

  const sampleDto = {
    providerId: "provider-1",
    wagererId: "wagerer-1",
    walletId: "wallet-123",
    externalTransactionId: "ext-tx-100",
    amount: "50.00",
    currency: "BRL",
    kind: WagerTransactionKind.Bet,
  } as ProcessWagerTransactionDto;

  beforeEach(() => {
    processWagerTransactionUseCaseMock = {
      execute: mock(),
    } as unknown as ProcessWagerTransactionUseCase;

    wagerTransactionRepositoryMock = {
      findById: mock(),
      findByExternalId: mock(),
      save: mock(),
    } as unknown as WagerTransactionRepositoryPort;

    controller = new WagerTransactionController(
      processWagerTransactionUseCaseMock,
      wagerTransactionRepositoryMock,
    );
  });

  describe("POST /wagering/transactions (createWagerTransaction)", () => {
    it("deve retornar 201 Created e o resultado em caso de sucesso", async () => {
      (
        processWagerTransactionUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue({
        transactionId: "tx-123",
        idempotentReplay: false,
      });

      const result = await controller.createWagerTransaction(
        "key-123",
        sampleDto,
      );

      expect(result).toEqual({
        transactionId: "tx-123",
        idempotentReplay: false,
      });
      expect(processWagerTransactionUseCaseMock.execute).toHaveBeenCalledWith({
        idempotencyKey: "key-123",
        ...sampleDto,
      });
    });

    it("deve lancar HTTP 409 Conflict quando ocorrer IdempotencyConflictError", async () => {
      (
        processWagerTransactionUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new IdempotencyConflictError("key-123"));

      try {
        await controller.createWagerTransaction("key-123", sampleDto);
        expect(true).toBe(false); // Nao deve atingir este ponto
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });

    it("deve lancar HTTP 404 Not Found quando ocorrer WalletNotFoundError", async () => {
      (
        processWagerTransactionUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new WalletNotFoundError("wallet-123"));

      try {
        await controller.createWagerTransaction("key-123", sampleDto);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe("GET /wagering/transactions/:transactionId", () => {
    it("deve retornar 200 OK com os dados da transacao quando encontrada", async () => {
      const mockTx = {
        id: "tx-123",
        providerId: "provider-1",
        externalTransactionId: "ext-tx-100",
        status: WagerTransactionStatus.Processed,
      };
      (
        wagerTransactionRepositoryMock.findById as ReturnType<typeof mock>
      ).mockResolvedValue(mockTx);

      const result = await controller.getWagerTransactionById("tx-123");

      expect(result).toEqual(mockTx as any);
      expect(wagerTransactionRepositoryMock.findById).toHaveBeenCalledWith(
        "tx-123",
      );
    });

    it("deve lancar HTTP 404 Not Found quando a transacao nao for encontrada", async () => {
      (
        wagerTransactionRepositoryMock.findById as ReturnType<typeof mock>
      ).mockResolvedValue(null);

      try {
        await controller.getWagerTransactionById("non-existent-id");
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe("GET /providers/:providerId/wagering/transactions/:externalTransactionId", () => {
    it("deve retornar 200 OK com os dados da transacao por ID externo", async () => {
      const mockTx = {
        id: "tx-123",
        providerId: "provider-1",
        externalTransactionId: "ext-tx-100",
      };
      (
        wagerTransactionRepositoryMock.findByExternalId as ReturnType<
          typeof mock
        >
      ).mockResolvedValue(mockTx);

      const result = await controller.getWagerTransactionByExternalId(
        "provider-1",
        "ext-tx-100",
      );

      expect(result).toEqual(mockTx as any);
      expect(
        wagerTransactionRepositoryMock.findByExternalId,
      ).toHaveBeenCalledWith("provider-1", "ext-tx-100");
    });

    it("deve lancar HTTP 404 Not Found quando a transacao externa nao for encontrada", async () => {
      (
        wagerTransactionRepositoryMock.findByExternalId as ReturnType<
          typeof mock
        >
      ).mockResolvedValue(null);

      try {
        await controller.getWagerTransactionByExternalId(
          "provider-1",
          "invalid-ext",
        );
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });
});
