import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ProcessWagerTransactionDto } from "../../../src/application/dtos/process-wager-transaction.dto";
import { WagerTransactionKind } from "../../../src/domain/enums";

describe("ProcessWagerTransactionDto", () => {
  it("deve validar com sucesso um DTO preenchido corretamente", async () => {
    const rawData = {
      providerId: "provider-1",
      wagererId: "wagerer-100",
      walletId: "wallet-abc",
      externalTransactionId: "ext-tx-999",
      amount: "150.00",
      currency: "BRL",
      kind: WagerTransactionKind.Bet,
    };

    const dto = plainToInstance(ProcessWagerTransactionDto, rawData);
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
  });

  it("deve rejeitar se o valor (amount) não possuir 2 casas decimais em formato string", async () => {
    const rawData = {
      providerId: "provider-1",
      wagererId: "wagerer-100",
      walletId: "wallet-abc",
      externalTransactionId: "ext-tx-999",
      amount: "150.5",
      currency: "BRL",
      kind: WagerTransactionKind.Bet,
    };

    const dto = plainToInstance(ProcessWagerTransactionDto, rawData);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe("amount");
  });

  it("deve rejeitar se a moeda (currency) não for ISO-4217 em maiúsculas", async () => {
    const rawData = {
      providerId: "provider-1",
      wagererId: "wagerer-100",
      walletId: "wallet-abc",
      externalTransactionId: "ext-tx-999",
      amount: "50.00",
      currency: "brl",
      kind: WagerTransactionKind.Bet,
    };

    const dto = plainToInstance(ProcessWagerTransactionDto, rawData);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe("currency");
  });

  it("deve gerar a estrutura canônica ordenada para idempotência", () => {
    const dto = new ProcessWagerTransactionDto();
    dto.providerId = "p1";
    dto.wagererId = "w1";
    dto.walletId = "wall1";
    dto.externalTransactionId = "ext1";
    dto.amount = "25.00";
    dto.currency = "BRL";
    dto.kind = WagerTransactionKind.Win;

    const canonical = dto.toCanonicalObject();

    expect(canonical).toEqual({
      amount: "25.00",
      currency: "BRL",
      externalTransactionId: "ext1",
      kind: WagerTransactionKind.Win,
      metadata: null,
      providerId: "p1",
      referenceExternalTransactionId: null,
      wagererId: "w1",
      walletId: "wall1",
    });
  });
});
