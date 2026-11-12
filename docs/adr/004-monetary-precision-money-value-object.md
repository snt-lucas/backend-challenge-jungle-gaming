# 4. Precisão Monetária Absoluta com Value Object Money e Centavos Inteiros (BigInt)

**Data:** 2026-11-10  
**Contexto Técnico:** Backend Challenge — Distributed Wagering Processor  

---

## Contexto e Problema
O edital estabelece a proibição estrita do tipo `number` / `float` (ponto flutuante IEEE 754) para cálculos financeiros (critério eliminatório).
Erros de arredondamento cumulativo geram quebra da equação contábil de partidas dobradas e distorções financeiras.

## Decisão Arquitetural
Adotar o **Value Object `Money`** (`src/domain/value-objects/money.vo.ts`) imutável:

### Detalhamento da Decisão:
1. **Armazenamento em Centavos Inteiros (`bigint`):** Qualquer quantia financeira é processada internamente como `BigInt` (centavos inteiros). R$ 10,00 é representado como `1000n`.
2. **Imutabilidade Absoluta:** Construtor privado e `Object.freeze()`. Métodos `add()`, `subtract()`, `negate()` retornam sempre novas instâncias.
3. **Validação de String Decimal com 2 Casas:** Aceita do exterior estritamente strings no formato `"100.50"` com validação por regex `/^-?\d+\.\d{2}$/`.
4. **Isolamento de Moeda (ISO-4217):** Operações aritméticas entre moedas divergentes disparam `CurrencyMismatchError`.

## Consequências
* **Positivas:**
  * Precisão contábil e matemática de 100%.
  * Impossibilidade de erros de escala ou arredondamento IEEE 754.
* **Negativas / Mitigações:**
  * Necessidade de parsing e serialização de/para string decimal com 2 casas na fronteira HTTP e banco de dados, tratada centralizadamente pelo VO `Money`.
