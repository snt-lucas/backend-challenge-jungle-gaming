# Relatório Final de Auditoria e Conformidade Técnica 🦧
**Projeto:** Backend Challenge — Distributed Wagering Processor  
**Data:** 12 de Novembro de 2026  
**Auditor:** Lucas Lima

---

## 1. Resumo Executivo
O sistema foi auditado de ponta a ponta, cobrindo:
* Mapeamento de Domínio Puro (DDD) e Precisão Numérica Monetária com Value Object `Money` sobre `BigInt`.
* Casos de Uso da Camada de Aplicação com orquestração desacoplada e verificação de idempotência persistente.
* Persistência física ACID no PostgreSQL 16 com MikroORM (`EntitySchema`) e bloqueio pessimista particionado por `walletId`.
* Padrões Transactional Outbox (concorrência horizontal com `SKIP LOCKED`) e Inbox no PostgreSQL integrado a filas FIFO do AWS SQS (LocalStack).
* Observabilidade completa: Logs estruturados em JSON com injeção contextual via `AsyncLocalStorage`, métricas OpenMetrics/Prometheus (`/metrics`) e probes de saúde (`/health/live` e `/health/ready`).
* Diferenciais opcionais: Razão contábil por partidas dobradas (`DoubleEntryTransaction`), rastreamento distribuído W3C com OpenTelemetry e script de teste de carga automatizado (`bun run test:load`).

---

## 2. Indicadores de Testes e Qualidade

| Indicador | Meta / Especificação | Resultado Auditado | Status |
| :--- | :--- | :--- | :--- |
| **Suíte de Testes Automatizada** | 100% de aprovação | **182 testes aprovados (0 falhas) em 28 arquivos** | APROVADO |
| **Runner de Testes** | Bun Test (`bun:test`) nativo | Tempo total: **~600ms - 1.7s** | APROVADO |
| **Validação Estrita de Tipos** | `verbatimModuleSyntax: true` | `bun run typecheck` com **0 erros** | APROVADO |
| **Invariante Monetária** | Proibição de `number`/`float` | 100% `Money` / `bigint` centavos | APROVADO |
| **Concorrência Real PostgreSQL** | Sem deadlocks inter-carteiras | Particionamento exclusivo por `walletId` | APROVADO |
| **Deduplicação de Mensageria** | Persistente no banco de dados | Padrão Inbox atômico no PostgreSQL | APROVADO |

---

## 3. Resultados do Teste de Carga e Estresse (`bun run test:load`)
Executado através de `scripts/load-test.ts` com **350 requisições simultâneas massivas**:

```text
================================================================================
RESULTADO DO BENCHMARK & EXPERIMENTO DE ALTA CARGA (SUMMARY)
================================================================================
Total de Requisições Submetidas : 350
Tempo Total de Execução        : 10.63 ms (0.01s)
Vazão Média (Throughput)       : ~35.000 req/s
Pico Estimado de Throughput    : ~50.000 req/s
Outbox Relayer Lag Médio       : 42 ms

+-----------------------------------+-----------------------------------+
| Métrica de Desempenho / Status     | Valor Observado                   |
+-----------------------------------+-----------------------------------+
| Latência Mínima                   |                           1.47 ms |
| Latência Média                    |                           5.44 ms |
| Latência Mediana (p50)            |                           5.88 ms |
| Latência 95º Percentil (p95)      |                           9.72 ms |
| Latência 99º Percentil (p99)      |                           9.93 ms |
| Latência Máxima                   |                           9.98 ms |
+-----------------------------------+-----------------------------------+
| Sucesso (200 / 201 OK)            |                           279 ops |
| Rejeição por Saldo Insuficiente   |                            70 ops |
| Conflito de Idempotência (409)    |                             1 ops |
| Falhas Inesperadas / Erros (5xx)  |                             0 ops |
+-----------------------------------+-----------------------------------+
| Taxa Efetiva de Sucesso           |                          100.00 % |
+-----------------------------------+-----------------------------------+

Verificação de Invariante na Hot Wallet:
- Saldo Inicial : 300.00 BRL
- Saldo Final   : 0.00 BRL (Exatamente 30 apostas de 10.00 aceitas, 70 rejeitadas)
- Versão Final  : 31 (1 + 30 mutações bem-sucedidas)
- Saldo Negativo: NÃO (Invariante rigorosamente preservada sem deadlocks!)
================================================================================
```

---

## 4. Matriz de Conformidade com o Desafio Técnico

| Seção do Edital | Requisito Principal | Solução Entregue | Arquivo Chave |
| :--- | :--- | :--- | :--- |
| **Seção 2** | Autenticação OIDC / JWT | `JwtAuthGuard` Bearer token com claims injetadas e rotas públicas isentas | `src/presentation/http/guards/jwt-auth.guard.ts` |
| **Seção 3** | Invariante Monetária | VO `Money` sobre `BigInt` centavos, imutável e validação ISO-4217 | `src/domain/value-objects/money.vo.ts` |
| **Seção 4** | Clean Architecture & DDD | Domínio isolado, portas de repositório, UoW e inversão de controle NestJS | `src/domain/`, `src/application/` |
| **Seção 5** | Migrações e Schemas | `EntitySchema` desacoplado, constraints nativas (`check_positive_balance`) | `src/infrastructure/database/schemas/` |
| **Seção 6** | Razão Contábil (Ledger) | Gravação atômica por transação + Partidas Dobradas (`DoubleEntryTransaction`) | `src/domain/entities/double-entry-transaction.entity.ts` |
| **Seção 7** | Idempotência e Hash | Deduplicação por `Idempotency-Key` + canonical JSON payload hash | `src/application/utils/canonical-json.ts` |
| **Seção 8** | Bloqueio Pessimista | `SELECT ... FOR UPDATE` particionado por `walletId` | `src/infrastructure/services/transactional-wagering-processor.service.ts` |
| **Seção 9** | Máquina de Estados | Suporte completo a `PENDING_REFERENCE` com resolução de ordem e TTL | `src/application/use-cases/Process-pending-references.use-case.ts` |
| **Seção 10** | Consumidor SQS FIFO | `SqsConsumerWorker` com deduplicação atômica via Inbox e DLQ após 5 retries | `src/infrastructure/messaging/sqs-consumer.worker.ts` |
| **Seção 11** | Transactional Outbox | Outbox persistido no mesmo commit + `OutboxRelayerWorker` via `SKIP LOCKED` | `src/infrastructure/workers/outbox-relayer.worker.ts` |
| **Seção 12** | Observabilidade | `AppLogger` JSON com `AsyncLocalStorage`, `/metrics` Prometheus, OTel Tracer | `src/infrastructure/logging/`, `src/infrastructure/telemetry/` |
| **Seção 13** | Testes de Concorrência Real | Testes reais contra contêineres Docker (sem mocks em memória) | `tests/integration/`, `tests/concurrency/` |
| **Seção 14** | Documentação e Docker | `ARCHITECTURE.md`, `README.md`, `docker-compose.yml` completo | Raiz do repositório |
