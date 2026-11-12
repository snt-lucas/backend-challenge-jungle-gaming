import { describe, it, expect, beforeEach, mock } from "bun:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import { WalletController } from "../../../src/presentation/http/controllers/wallet.controller";
import type { CreateWalletUseCase } from "../../../src/application/use-cases/create-wallet.use-case";
import type { GetWalletUseCase } from "../../../src/application/use-cases/get-wallet.use-case";
import type { ReconcileWalletUseCase } from "../../../src/application/use-cases/reconcile-wallet.use-case";
import type { GetWalletLedgerUseCase } from "../../../src/application/use-cases/get-wallet-ledger.use-case";
import { WalletNotFoundError } from "../../../src/application/errors";

describe("WalletController", () => {
  let controller: WalletController;
  let createWalletUseCaseMock: CreateWalletUseCase;
  let getWalletUseCaseMock: GetWalletUseCase;
  let reconcileWalletUseCaseMock: ReconcileWalletUseCase;
  let getWalletLedgerUseCaseMock: GetWalletLedgerUseCase;

  beforeEach(() => {
    createWalletUseCaseMock = {
      execute: mock(),
    } as unknown as CreateWalletUseCase;
    getWalletUseCaseMock = {
      execute: mock(),
    } as unknown as GetWalletUseCase;
    reconcileWalletUseCaseMock = {
      execute: mock(),
    } as unknown as ReconcileWalletUseCase;
    getWalletLedgerUseCaseMock = {
      execute: mock(),
    } as unknown as GetWalletLedgerUseCase;

    controller = new WalletController(
      createWalletUseCaseMock,
      getWalletUseCaseMock,
      reconcileWalletUseCaseMock,
      getWalletLedgerUseCaseMock,
    );
  });

  describe("POST /wallets (createWallet)", () => {
    it("deve retornar 201 Created com a carteira criada", async () => {
      const mockWallet = {
        id: "wallet-100",
        userId: "user-1",
        balance: "0.00",
        currency: "BRL",
      };
      (
        createWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue(mockWallet);

      const result = await controller.createWallet({
        userId: "user-1",
        currency: "BRL",
      });

      expect(result).toEqual(mockWallet as any);
      expect(createWalletUseCaseMock.execute).toHaveBeenCalledWith(
        "user-1",
        "BRL",
      );
    });

    it("deve lancar HTTP 404 Not Found se o usuario da carteira nao for encontrado", async () => {
      (
        createWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new WalletNotFoundError("wallet-missing"));

      try {
        await controller.createWallet({
          userId: "user-unknown",
          currency: "BRL",
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe("GET /wallets/:id (getWalletById)", () => {
    it("deve retornar 200 OK com os dados da carteira", async () => {
      const mockWallet = {
        id: "wallet-100",
        userId: "user-1",
        balance: "100.00",
        currency: "BRL",
      };
      (
        getWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue(mockWallet);

      const result = await controller.getWalletById("wallet-100");

      expect(result).toEqual(mockWallet as any);
      expect(getWalletUseCaseMock.execute).toHaveBeenCalledWith("wallet-100");
    });

    it("deve lancar HTTP 404 Not Found se a carteira nao existir", async () => {
      (
        getWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new WalletNotFoundError("wallet-missing"));

      try {
        await controller.getWalletById("wallet-missing");
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe("POST /wallets/:walletId/reconciliation (reconcileWallet)", () => {
    it("deve retornar 200 OK com status de sucesso na reconciliacao", async () => {
      (
        reconcileWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue({
        discrepanciesFound: 0,
        reconciledAmount: "0.00",
      });

      const result = await controller.reconcileWallet("wallet-100", {
        referencedTransactions: ["tx-1"],
      });

      expect(result.success).toBe(true);
      expect(reconcileWalletUseCaseMock.execute).toHaveBeenCalledWith(
        "wallet-100",
        ["tx-1"],
      );
    });

    it("deve lancar HTTP 404 Not Found se a carteira nao for encontrada na reconciliacao", async () => {
      (
        reconcileWalletUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new WalletNotFoundError("wallet-missing"));

      try {
        await controller.reconcileWallet("wallet-missing", {});
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe("GET /wallets/:walletId/ledger (getWalletLedger)", () => {
    it("deve retornar 200 OK com a lista de lancamentos do ledger", async () => {
      const mockEntries = [
        { id: "entry-1", amount: "50.00", direction: "CREDIT" },
        { id: "entry-2", amount: "20.00", direction: "DEBIT" },
      ];
      (
        getWalletLedgerUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue(mockEntries);

      const result = await controller.getWalletLedger(
        "wallet-100",
        "cursor-abc",
        20,
      );

      expect(result).toEqual(mockEntries as any);
      expect(getWalletLedgerUseCaseMock.execute).toHaveBeenCalledWith(
        "wallet-100",
        "cursor-abc",
        20,
      );
    });

    it("deve usar limit padrao 50 quando limit nao for fornecido", async () => {
      (
        getWalletLedgerUseCaseMock.execute as ReturnType<typeof mock>
      ).mockResolvedValue([]);

      await controller.getWalletLedger("wallet-100");

      expect(getWalletLedgerUseCaseMock.execute).toHaveBeenCalledWith(
        "wallet-100",
        undefined,
        50,
      );
    });

    it("deve lancar HTTP 404 Not Found se a carteira nao for encontrada no ledger", async () => {
      (
        getWalletLedgerUseCaseMock.execute as ReturnType<typeof mock>
      ).mockRejectedValue(new WalletNotFoundError("wallet-missing"));

      try {
        await controller.getWalletLedger("wallet-missing");
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });
});
