# 2. Estratégia de Concorrência via Pessimistic Locking Particionado por WalletId

**Data:** 2026-11-10  
**Contexto Técnico:** Backend Challenge — Distributed Wagering Processor  

---

## Contexto e Problema
Em plataformas de iGaming, dezenas ou centenas de requisições concorrentes podem disputar o saldo da mesma carteira no mesmo milissegundo (ex: rodadas simultâneas de slots, apostas rápidas em mesas ao vivo).
Se a estratégia de concorrência for inadequada:
* Leituras concorrentes sem bloqueio levam a *lost updates* e saldos negativos.
* Bloqueios globais ou locks mal particionados criam gargalos de desempenho e riscos graves de *deadlocks* entre transações de diferentes jogadores.

## Decisão Arquitetural
Adotar **Pessimistic Locking (`SELECT ... FOR UPDATE`) particionado exclusivamente por `walletId`**.

### Detalhamento da Decisão:
1. Toda transação de mutação adquire bloqueio exclusivo sobre a linha física da carteira:
   ```sql
   SELECT id, player_id, currency, balance_cents, version
   FROM wallets
   WHERE id = $1
   FOR UPDATE;
   ```
2. **Particionamento Estrito por Carteira:** Como apostas e ganhos operam estritamente sobre a carteira do próprio jogador, não existe disputa entre diferentes jogadores. Transações de carteiras distintas executam em paralelo no PostgreSQL.
3. **Serialização Limpa:** Para a mesma carteira, as transações são enfileiradas ordenadamente pelo PostgreSQL. A primeira debita e comita; a subsequente enxerga o saldo já reduzido e, se insuficiente, é rejeitada pelo domínio (`InsufficientFunds`) sem inconsistências.
4. **Controle de Versão (`version`):** A coluna inteira `version` é incrementada a cada mutação de saldo, servindo como auditoria de reconciliação e controle otimista downstream.

## Consequências
* **Positivas:**
  * Impossibilidade matemática de saldo negativo ou *lost update*.
  * Ausência de deadlocks inter-carteiras.
  * Comportamento comprovado sob estresse de 150 apostas simultâneas (testes reais).
* **Negativas / Mitigações:**
  * Throughput individual de uma única carteira ("hot wallet") é delimitado pela latência de commit do banco de dados (mitigado pelo rápido ciclo de transações no PostgreSQL).
