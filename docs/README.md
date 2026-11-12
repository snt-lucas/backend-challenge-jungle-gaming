# Portal de Documentação Técnica — Distributed Wagering Processor 🦧
**Software House:** Jungle Gaming  
**Organização:** Clean Architecture, DDD, ADRs e Dossiês Técnicos de Engenharia

---

## 1. Estrutura e Organização da Pasta `docs/`

Seguindo as melhores práticas de mercado para repositórios corporativos de missão crítica, a documentação está modularizada para evitar poluição visual na raiz do projeto e fornecer rastreabilidade granular:

```text
docs/
├── README.md                                  # Este portal central de navegação
├── challenge/                                 # Especificação oficial do desafio da Jungle Gaming
│   └── CHALLENGE.md                           # Requisitos, regras eliminatórias e pontuação
├── modules/                                   # Dossiês técnicos por camada e subsistema
│   ├── domain-layer.md                        # Dossiê: Entidades, Value Objects e Invariantes
│   ├── application-layer.md                   # Dossiê: Casos de Uso, Portas e DTOs
│   ├── presentation-layer.md                  # Dossiê: Controladores RESTful e Status Codes
│   ├── infrastructure-and-integration.md      # Dossiê: Persistência, ACID e Outbox Pattern
│   ├── messaging-and-sqs-consumer.md          # Dossiê: AWS SQS FIFO, Inbox e DLQ
│   ├── mikro-orm-entities-and-migrations.md   # Dossiê: Schemas desacoplados e Migrations
│   ├── observability-and-telemetry.md         # Dossiê: Logs JSON, Métricas OTel e Health Probes
│   └── concurrency-and-stress-testing.md      # Dossiê: Concorrência massiva e Invariante Contábil
├── adr/                                       # Architecture Decision Records (ADRs)
│   ├── 001-mikro-orm-selection.md             # ADR 001: Adoção do MikroORM e Exclusão do Prisma
│   ├── 002-partitioned-pessimistic-locking.md # ADR 002: SELECT ... FOR UPDATE particionado por Wallet
│   ├── 003-transactional-outbox-inbox-sqs-fifo.md # ADR 003: Outbox (SKIP LOCKED) e Inbox no PostgreSQL
│   ├── 004-monetary-precision-money-value-object.md # ADR 004: Money VO sobre BigInt e Proibição de IEEE 754
│   └── 005-double-entry-bookkeeping-ledger.md # ADR 005: Modelagem de Partidas Dobradas (Seção 6.4)
└── reports/                                   # Relatórios técnicos e auditorias
    └── final-audit-report.md                  # Relatório de auditoria de conformidade e testes
```

---

## 2. Dossiês Técnicos por Camada (`docs/modules/`)

Cada documento em `modules/` atua como uma especificação detalhada de engenharia e guia de testes:

| Dossiê | Camada / Módulo | Principais Tópicos Cobertos |
| :--- | :--- | :--- |
| [**`domain-layer.md`**](./modules/domain-layer.md) | Domínio | Agregado `Wallet`, Value Object `Money`, partidas dobradas, regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. |
| [**`application-layer.md`**](./modules/application-layer.md) | Aplicação | Orquestração com `ProcessWagerTransactionUseCase`, `UnitOfWorkPort`, DTOs canônicos e idempotência. |
| [**`presentation-layer.md`**](./modules/presentation-layer.md) | Apresentação | Controladores NestJS, códigos HTTP semânticos (200, 201, 404, 409, 503), validação com `class-validator`. |
| [**`infrastructure-and-integration.md`**](./modules/infrastructure-and-integration.md) | Infraestrutura | Persistência real no PostgreSQL, Transactional Outbox com `SKIP LOCKED` e integridade referencial. |
| [**`messaging-and-sqs-consumer.md`**](./modules/messaging-and-sqs-consumer.md) | Mensageria | Consumidor SQS FIFO com deduplicação atômica via Inbox no PostgreSQL, Dead Letter Queue (DLQ) e graceful shutdown. |
| [**`mikro-orm-entities-and-migrations.md`**](./modules/mikro-orm-entities-and-migrations.md) | Banco de Dados | Schemas declarativos via `EntitySchema`, constraints físicas (`check_positive_balance`), migrations versionadas. |
| [**`observability-and-telemetry.md`**](./modules/observability-and-telemetry.md) | Observabilidade | Logs JSON com `AsyncLocalStorage`, coletor Prometheus (`/metrics`), health checks (`/health/ready`, `/health/live`). |
| [**`concurrency-and-stress-testing.md`**](./modules/concurrency-and-stress-testing.md) | Concorrência | Cenários de estresse concorrente, ausência de deadlocks, invariante matemática do razão e teste de carga. |
| [**`CHALLENGE.md`**](./challenge/CHALLENGE.md) | Especificação | Documento original de requisitos, regras eliminatórias e critérios de pontuação da Jungle Gaming. |

---

## 3. Architecture Decision Records (`docs/adr/`)

Registros imutáveis de decisões de arquitetura de software no padrão canônico de Michael Nygard:

* [**ADR 001: Escolha do MikroORM e Exclusão do Prisma**](./adr/001-mikro-orm-selection.md)
* [**ADR 002: Pessimistic Locking Particionado por WalletId**](./adr/002-partitioned-pessimistic-locking.md)
* [**ADR 003: Transactional Outbox (SKIP LOCKED) e Inbox Persistente com AWS SQS FIFO**](./adr/003-transactional-outbox-inbox-sqs-fifo.md)
* [**ADR 004: Precisão Monetária Absoluta com Value Object Money e Centavos Inteiros (BigInt)**](./adr/004-monetary-precision-money-value-object.md)
* [**ADR 005: Modelagem Contábil por Partidas Dobradas (Double-Entry Bookkeeping)**](./adr/005-double-entry-bookkeeping-ledger.md)

---

## 4. Documentos Globais na Raiz do Repositório

Para a visão executiva e inicialização rápida do projeto:
* 📖 [**`ARCHITECTURE.md` (Raiz)**](../ARCHITECTURE.md): Dossiê executivo de arquitetura exigido pela Seção 14 (5.0 pontos na avaliação).
* 🚀 [**`README.md` (Raiz)**](../README.md): Guia rápido para o avaliador com pré-requisitos, Docker Compose, execução de testes e exemplos de chamadas `curl`.
