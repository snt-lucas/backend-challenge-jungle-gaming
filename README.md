# Distributed Wagering Processor — Backend Challenge 🦧
**Software House:** Jungle Gaming  
**Stack Principal:** NestJS, Bun 1.x, PostgreSQL 16, AWS SQS (LocalStack), MikroORM, Clean Architecture & DDD.

[![Bun Test](https://img.shields.io/badge/Bun%20Test-182%20Passing-brightgreen)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20verbatimModuleSyntax-blue)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16--alpine-336791)](https://www.postgresql.org)
[![AWS SQS](https://img.shields.io/badge/AWS%20SQS-FIFO%20Queue-orange)](https://aws.amazon.com/sqs/)

---

## 1. Guia Rápido para Avaliação (Evaluator Quickstart)

### 1.1. Pré-requisitos
* **[Bun 1.x](https://bun.sh/)** (versão 1.1 ou superior recomendada).
* **[Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/)**.

---

### 1.2. Variáveis de Ambiente
O projeto já conta com um template pré-configurado [`./.env.example`](./.env.example). Para utilizá-lo:

```bash
cp .env.example .env
```

Conteúdo padrão do `.env`:
```ini
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgrespassword@localhost:5432/wagering
AWS_ENDPOINT_URL=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localhost:4566/000000000000/wager-transactions.fifo
SQS_DLQ_URL=http://localhost:4566/000000000000/wager-transactions-dlq.fifo
```

---

### 1.3. Como Subir a Infraestrutura Completa (Docker Compose)
O comando abaixo provisiona automaticamente todos os contêineres e inicializa as filas FIFO do SQS sem necessidade de scripts manuais adicionais:

```bash
docker compose up -d
```

Serviços orquestrados:
1. **`postgres`**: PostgreSQL 16 Alpine na porta `5432` com volume persistente e healthcheck ativo (`pg_isready`).
2. **`localstack`**: LocalStack na porta `4566` com serviço SQS ativo e healthcheck HTTP.
3. **`init-sqs`**: Contêiner efêmero baseado no AWS CLI que aguarda o LocalStack ficar saudável e cria as filas FIFO obrigatórias:
   - `wager-transactions.fifo` (`ContentBasedDeduplication=false`, pois a deduplicação reside no domínio)
   - `wager-transactions-dlq.fifo`
4. **`app`**: Aplicação NestJS sob o runtime Bun na porta `3000`, inicializada estritamente após a prontidão dos bancos e mensageria.

---

### 1.4. Como Rodar as Migrações de Banco de Dados
Para aplicar o schema contábil e as constraints de integridade no PostgreSQL:

```bash
bun x mikro-orm migration:up
```

---

### 1.5. Como Rodar Todas as Suítes de Teste
A suíte conta com **182 testes com 100% de aprovação (em 28 arquivos)**, executados diretamente pelo runner nativo do Bun (`bun:test`):

```bash
# 1. Validação estrita de tipos TypeScript (verbatimModuleSyntax)
bun run typecheck

# 2. Execução da suíte completa de testes (182 testes em 28 arquivos)
# Nota: --max-concurrency=1 garante execução limpa sem conflitos de TRUNCATE em bancos reais
bun test --max-concurrency=1

# 3. Testes unitários de Domínio e Casos de Uso da Aplicação
bun test tests/domain/ tests/application/

# 4. Testes de Contrato e Controladores HTTP
bun test tests/presentation/http/

# 5. Testes de Integração e Concorrência Real com PostgreSQL e LocalStack
bun test tests/integration/ tests/concurrency/

# 6. Teste de Carga e Estresse Automatizado (350 requisições simultâneas a ~35k req/s)
bun run test:load
```

---

## 2. Tabela de Rotas HTTP Implementadas & Exemplos `curl`

| Método | Rota | Descrição | Status Codes |
| :--- | :--- | :--- | :--- |
| **POST** | `/wallets` | Criação de carteira com saldo inicial | `201 Created`, `400 Bad Request` |
| **GET** | `/wallets/:id` | Consulta de carteira por ID | `200 OK`, `404 Not Found` |
| **POST** | `/wallets/:walletId/reconciliation` | Reconciliação do saldo contra o Ledger | `200 OK`, `404 Not Found` |
| **GET** | `/wallets/:walletId/ledger` | Extrato contábil paginado (`?limit=50`) | `200 OK`, `404 Not Found` |
| **POST** | `/wagering/transactions` | Processamento de aposta/transação | `201 Created`, `404 Not Found`, `409 Conflict` |
| **GET** | `/wagering/transactions/:transactionId` | Consulta de transação por ID interno | `200 OK`, `404 Not Found` |
| **GET** | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta de transação por ID do provedor | `200 OK`, `404 Not Found` |
| **GET** | `/health/live` | Liveness probe do processo | `200 OK` |
| **GET** | `/health/ready` | Readiness probe com teste real de DB e SQS | `200 OK`, `503 Service Unavailable` |
| **GET** | `/metrics` | Métricas operacionais em formato Prometheus | `200 OK` |

---

### Exemplos Práticos de Chamada via `curl`

#### 1. Criar Carteira com Saldo Inicial
```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "currency": "BRL",
    "initialBalance": "100.00"
  }'
```

#### 2. Submeter Aposta (com Idempotency-Key obrigatória)
```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "idempotency-key: pragmatic:tx-round-101" \
  -d '{
    "providerId": "pragmatic",
    "externalTransactionId": "tx-round-101",
    "wagererId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "gates-of-olympus",
    "kind": "BET",
    "amount": "25.00",
    "currency": "BRL"
  }'
```

#### 3. Consultar Saldo da Carteira
```bash
curl -X GET http://localhost:3000/wallets/0192f291-27dd-7d3f-8071-5f8685deef37
```

#### 4. Consultar Lançamentos do Razão Contábil (Ledger)
```bash
curl -X GET "http://localhost:3000/wallets/0192f291-27dd-7d3f-8071-5f8685deef37/ledger?limit=50"
```

#### 5. Reconciliação Contábil da Carteira
```bash
curl -X POST http://localhost:3000/wallets/0192f291-27dd-7d3f-8071-5f8685deef37/reconciliation
```

#### 6. Probes de Saúde (Liveness e Readiness)
```bash
# Liveness probe
curl -i http://localhost:3000/health/live

# Readiness probe (validação ativa de PostgreSQL e SQS)
curl -i http://localhost:3000/health/ready
```

#### 7. Coleta de Métricas Prometheus
```bash
curl -X GET http://localhost:3000/metrics
```

---

## 3. Arquitetura e Decisões de Engenharia

O detalhamento aprofundado com justificativas de engenharia, diagramas de sequência, trade-offs e limitações encontra-se registrado no documento oficial:

📖 **[Consulte o documento completo ARCHITECTURE.md](./ARCHITECTURE.md)**

### Principais Invariantes Comprovadas:
1. **Precisão Monetária Absoluta:** Manipulação de dinheiro através do Value Object `Money` baseado em centavos inteiros (`BigInt`), proibindo tipos de ponto flutuante (IEEE 754).
2. **Pessimistic Locking (`SELECT ... FOR UPDATE`):** Bloqueio estrito particionado por `walletId`, eliminando *lost updates* e garantindo que requisições concorrentes não criem deadlocks entre carteiras distintas.
3. **Invariante Matemática do Razão:**
   $$\text{Wallet.balance} \equiv \text{initialBalance} - \sum_{\text{DEBIT}} \text{Ledger.money} + \sum_{\text{CREDIT}} \text{Ledger.money}$$
4. **Transactional Outbox & Inbox:** Persistência atômica no PostgreSQL de Carteira, Ledger, Inbox e Outbox sob o mesmo commit, com publicação concorrente via worker `SKIP LOCKED`.
5. **Resolução de Mensagens Fora de Ordem (`PENDING_REFERENCE`):** Estornos (`REFUND` / `ROLLBACK`) que chegam antes da aposta original entram em espera ativa e são reconciliados automaticamente via máquina de estados finita ou expirados por TTL.

---

### Transparência no Processo de Engenharia:
Todas as decisões arquiteturais, modelagem contábil de domínio e formulação de invariantes foram conduzidas integralmente pelo autor do projeto. Para viabilizar a entrega de arquitetura de alta maturidade dentro do **timebox de 3 dias**, ferramentas modernas de IA (Google Antigravity, Cline, Continue, Ollama com DeepSeek-R1 e Qwen Coder, e Gemini) atuaram como aceleradores de produtividade (*pair programming* e *scaffolding*), sob estrita auditoria humana e validação determinística (182 testes automatizados em infraestrutura real). Detalhes completos disponíveis na [Seção 10 do ARCHITECTURE.md](./ARCHITECTURE.md#10-processo-de-engenharia-e-uso-assistido-de-ia-transparência).
