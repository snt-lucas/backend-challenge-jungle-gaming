import { describe, expect, it } from "bun:test";
import { CurrencyMismatchError } from "../../../src/domain/errors/currency-mismatch.error";
import { InvalidMoneyError } from "../../../src/domain/errors/invalid-money.error";
import { Money } from "../../../src/domain/value-objects/money.vo";

describe("Money Value Object", () => {
  describe("Criação e instanciação", () => {
    it("deve criar uma instância válida a partir de string decimal com 2 casas", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });

      expect(money).toBeDefined();
      expect(money.amount).toBe("100.00");
      expect(money.currency).toBe("BRL");
      expect(money.toString()).toBe("100.00 BRL");
      expect(money.toJSON()).toEqual({ amount: "100.00", currency: "BRL" });
    });

    it("deve criar valor zero corretamente", () => {
      const zero = Money.zero("BRL");

      expect(zero.amount).toBe("0.00");
      expect(zero.currency).toBe("BRL");
      expect(zero.isZero()).toBe(true);
    });

    it("deve normalizar o código da moeda para maiúsculo e validar formato ISO-4217", () => {
      const money = Money.from({ amount: "50.00", currency: "brl" });
      expect(money.currency).toBe("BRL");
    });
    it("deve criar via factory fromCents e expor getter cents", () => {
      const money = Money.fromCents(12345n, "BRL");
      expect(money.amount).toBe("123.45");
      expect(money.cents).toBe(12345n);
    });

    it("deve permitir valores negativos quando explicitamente habilitado via options.allowNegative", () => {
      const negativeMoney = Money.from(
        { amount: "-100.50", currency: "BRL" },
        { allowNegative: true },
      );
      expect(negativeMoney.amount).toBe("-100.50");
      expect(negativeMoney.isNegative()).toBe(true);
    });

    it("deve formatar corretamente centavos negativos menores que um real", () => {
      const smallNeg = Money.fromCents(-5n, "BRL");
      expect(smallNeg.amount).toBe("-0.05");
      expect(smallNeg.isNegative()).toBe(true);
    });
  });

  describe("Rejeição de entradas inválidas", () => {
    it("deve rejeitar se props não for um objeto válido ou currency não for string", () => {
      // @ts-expect-error teste proposital de runtime
      expect(() => Money.from(null)).toThrow(InvalidMoneyError);
      // @ts-expect-error teste proposital de runtime
      expect(() => Money.from(undefined)).toThrow(InvalidMoneyError);
      // @ts-expect-error teste proposital de runtime
      expect(() => Money.from({ amount: "10.00", currency: 123 })).toThrow(
        InvalidMoneyError,
      );
    });
    it("deve rejeitar se o valor recebido for number ou float em vez de string", () => {
      // @ts-expect-error teste proposital de runtime contra tipos number
      expect(() => Money.from({ amount: 100, currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      // @ts-expect-error teste proposital de runtime contra float
      expect(() => Money.from({ amount: 99.99, currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("deve rejeitar NaN, Infinity e -Infinity", () => {
      // @ts-expect-error teste proposital de runtime
      expect(() => Money.from({ amount: NaN, currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      // @ts-expect-error teste proposital de runtime
      expect(() => Money.from({ amount: Infinity, currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() =>
        Money.from({ amount: "NaN", currency: "BRL" }),
      ).toThrow(InvalidMoneyError);
      expect(() =>
        Money.from({ amount: "Infinity", currency: "BRL" }),
      ).toThrow(InvalidMoneyError);
    });

    it("deve rejeitar strings sem escala decimal fixa de 2 casas", () => {
      expect(() => Money.from({ amount: "100", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100.5", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100.555", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100.0000", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("deve rejeitar notação científica, strings vazias e caracteres não-numéricos", () => {
      expect(() => Money.from({ amount: "1e2", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "1.00e2", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "   ", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100,00", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("deve rejeitar valores negativos em contratos de entrada padrão", () => {
      expect(() =>
        Money.from({ amount: "-25.00", currency: "BRL" }),
      ).toThrow(InvalidMoneyError);
    });

    it("deve rejeitar código de moeda inválido", () => {
      expect(() => Money.from({ amount: "25.00", currency: "" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "25.00", currency: "B" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "25.00", currency: "BRLX" })).toThrow(
        InvalidMoneyError,
      );
    });
  });

  describe("Imutabilidade e operações aritméticas", () => {
    it("deve somar dois valores mantendo as instâncias originais inalteradas", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "50.50", currency: "BRL" });

      const result = a.add(b);

      expect(result.amount).toBe("150.50");
      expect(result.currency).toBe("BRL");

      // Verificação estrita de imutabilidade
      expect(a.amount).toBe("100.00");
      expect(b.amount).toBe("50.50");
      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
    });

    it("deve subtrair dois valores mantendo as instâncias originais inalteradas", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "25.75", currency: "BRL" });

      const result = a.subtract(b);

      expect(result.amount).toBe("74.25");
      expect(a.amount).toBe("100.00");
      expect(b.amount).toBe("25.75");
      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
    });

    it("não deve sofrer de imprecisão de ponto flutuante em somas de centavos (ex: 0.10 + 0.20 = 0.30)", () => {
      const m1 = Money.from({ amount: "0.10", currency: "BRL" });
      const m2 = Money.from({ amount: "0.20", currency: "BRL" });

      const sum = m1.add(m2);

      expect(sum.amount).toBe("0.30");
    });

    it("deve suportar negate() gerando uma nova instância com valor oposto", () => {
      const positive = Money.from({ amount: "50.00", currency: "BRL" });
      const negated = positive.negate();

      expect(negated.amount).toBe("-50.00");
      expect(negated.isNegative()).toBe(true);
      expect(positive.amount).toBe("50.00");
    });
  });

  describe("Bloqueio de moedas distintas", () => {
    it("deve lançar CurrencyMismatchError ao tentar somar moedas diferentes", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const usd = Money.from({ amount: "100.00", currency: "USD" });

      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    });

    it("deve lançar CurrencyMismatchError ao tentar subtrair moedas diferentes", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const eur = Money.from({ amount: "50.00", currency: "EUR" });

      expect(() => brl.subtract(eur)).toThrow(CurrencyMismatchError);
    });

    it("deve lançar CurrencyMismatchError ao comparar grandezas de moedas distintas", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const usd = Money.from({ amount: "100.00", currency: "USD" });

      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.isGreaterThan(usd)).toThrow(CurrencyMismatchError);
    });

    it("deve retornar false no equals ao comparar moedas distintas", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const usd = Money.from({ amount: "100.00", currency: "USD" });

      expect(brl.equals(usd)).toBe(false);
    });
  });

  describe("Comparações e predicados de domínio", () => {
    it("deve comparar igualdade de valor e moeda", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "100.00", currency: "BRL" });
      const c = Money.from({ amount: "100.01", currency: "BRL" });

      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it("deve avaliar predicates de sinal e magnitude (isZero, isPositive, isNegative, isLessThan, isGreaterThan)", () => {
      const zero = Money.zero("BRL");
      const pos = Money.from({ amount: "10.00", currency: "BRL" });
      const neg = pos.negate();

      expect(zero.isZero()).toBe(true);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);

      expect(pos.isZero()).toBe(false);
      expect(pos.isPositive()).toBe(true);
      expect(pos.isNegative()).toBe(false);

      expect(neg.isNegative()).toBe(true);
      expect(neg.isPositive()).toBe(false);

      expect(zero.isLessThan(pos)).toBe(true);
      expect(pos.isGreaterThan(zero)).toBe(true);
      expect(pos.isGreaterThanOrEqual(pos)).toBe(true);
      expect(zero.isLessThanOrEqual(pos)).toBe(true);
    });
  });
});
