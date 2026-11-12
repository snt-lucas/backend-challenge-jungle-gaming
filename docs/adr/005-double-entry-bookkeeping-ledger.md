# 5. Modelagem Contábil por Partidas Dobradas (Double-Entry Bookkeeping)

**Data:** 2026-11-11  
**Contexto Técnico:** Backend Challenge — Distributed Wagering Processor (Seção 6.4)  

---

## Contexto e Problema
A Seção 6.4 do README propõe a evolução do razão simples para partidas dobradas estruturais (*Double-Entry Bookkeeping*), exigindo que a contrapartida contábil de cada movimentação financeira seja explícita (contas da casa ou do provedor) em vez de implícita.

## Decisão Arquitetural
Implementar a entidade de domínio `DoubleEntryTransaction` (`src/domain/entities/double-entry-transaction.entity.ts`):

### Detalhamento da Decisão:
1. **Contas de Contrapartida Explícitas:**
   * Conta do Jogador: `WALLET:{walletId}`
   * Conta de Retenção/Custódia da Casa: `HOUSE:ESCROW:{providerId}`
   * Conta de Receita/Liquidação de Prêmios: `HOUSE:REVENUE:{providerId}`
2. **Mapeamento de Operações:**
   * `BET`: Débito na carteira do jogador e Crédito em `HOUSE:ESCROW:{providerId}`.
   * `WIN`: Débito em `HOUSE:REVENUE:{providerId}` e Crédito na carteira do jogador.
   * `REFUND` / `ROLLBACK`: Débito em `HOUSE:ESCROW:{providerId}` e Crédito na carteira do jogador.
3. **Invariante Matemática:**
   $$\sum \text{Débitos} \equiv \sum \text{Créditos}$$
   Se a soma de débitos divergir da soma de créditos, a transação é rejeitada com `UnbalancedJournalEntryError`.

## Consequências
* **Positivas:**
  * Rastreabilidade e auditabilidade corporativa de nível bancário.
  * Extrema clareza na conciliação financeira entre jogador, casa e provedor.
* **Negativas / Mitigações:**
  * Cada transação gera pelo menos dois registros de lançamento no razão contábil.
