# Módulo: Infraestrutura, Migrações e Testes de Integração (`src/infrastructure`, `test/integration`)

---

## SEÇÃO 1: ENGENHARIA DE SOFTWARE (Technical Specification)

### 1. Visão Geral e Responsabilidade
O módulo de Infraestrutura provê os adaptadores de persistência e orquestração de banco de dados PostgreSQL real, migrações de schema com integridade referencial e constraints declarativas, além de workers assíncronos (`OutboxRelayerWorker` e `PendingReferenceTtlWorker`). Sua responsabilidade é garantir a consistência das transações ACID, execução de bloqueios pessimistas (`SELECT ... FOR UPDATE`), concorrência com `SKIP LOCKED` e auditoria contábil física no schema do banco.

### 2. Motivação e Justificativa (Por que existe?)
Em processadores financeiros distribuídos de alta concorrência:
* Validações apenas em memória ou código de aplicação são insuficientes contra race conditions entre múltiplas réplicas da aplicação.
* O banco de dados PostgreSQL deve atuar como a última linha de defesa com constraints físicas (`check_positive_balance`, `check_ledger_equation`, unicidade de chaves).
* O processamento concorrente da tabela `outbox_messages` exige o padrão `SELECT ... FOR UPDATE SKIP LOCKED` para permitir escalabilidade horizontal de workers sem risco de duplicação de mensagens no broker (SQS).
* Mensagens dependentes que chegam fora de ordem (`PENDING_REFERENCE`) exigem resiliência baseada em TTL para evitar deadlocks de transações infinitamente pendentes.

#### Invariantes e Garantias Físicas Asseguradas:
* **Atomicidade Transacional (ACID)**:
  - Na mesma transação SQL (`BEGIN ... COMMIT`), o sistema bloqueia a carteira com `LockMode.PESSIMISTIC_WRITE` (`SELECT ... FOR UPDATE`), atualiza o saldo, insere o registro no razão (`wallet_ledger_entries`), confirma a deduplicação no `inbox_messages` e enfileira o evento de integração no `outbox_messages`.
* **Constraint Física no Schema (`check_positive_balance`)**:
  - `CONSTRAINT check_positive_balance CHECK (balance_cents >= 0)` impede a persistência de saldo negativo mesmo se comandos manuais ou falhas de aplicação tentarem atualizar o registro.
* **Escalabilidade Sem Duplicação (`SKIP LOCKED`)**:
  - Múltiplos workers disputam lotes de mensagens simultaneamente; cada linha bloqueada por um worker é ignorada pelos demais sem contenção ou bloqueio em cascata.
* **Resiliência e TTL para Referências Órfãs**:
  - Mensagens em `PENDING_REFERENCE` cujo TTL é excedido transitam automaticamente para `REJECTED` por `REFERENCE_NOT_FOUND`, emitindo o evento de integração correspondente.

### 3. Detalhamento Técnico da Implementação

#### Componentes do Módulo
| Componente | Tipo | Responsabilidade |
|---|---|---|
| `001_initial_schema.sql` | Migration SQL | Schema físico com constraints (`check_positive_balance`, `check_ledger_equation`, chaves únicas). |
| `TransactionalWageringProcessorService` | Service | Orquestra a transação atômica completa com lock pessimista (`SELECT FOR UPDATE`). |
| `OutboxRelayerWorker` | Worker | Lê lotes ordenados da outbox com `FOR UPDATE SKIP LOCKED`, publica no broker e marca `published_at`. |
| `PendingReferenceTtlWorker` | Worker | Identifica transações `PENDING_REFERENCE` expiradas e as transiciona para `REJECTED` emitindo evento de falha. |
| `PostgresTestHelper` | Test Utility | Gerencia conexão nativa com Bun SQL, migrações e limpeza de tabelas entre suítes de teste. |
| `docker-compose.yml` | Orquestração | Sobe instâncias reais de PostgreSQL 16 e LocalStack (com SQS FIFO). |

#### Diagrama de Concorrência: Worker Outbox Relayer (`SKIP LOCKED`)
```mermaid
sequenceDiagram
    autonumber
    actor W1 as Worker 1
    actor W2 as Worker 2
    participant DB as PostgreSQL (outbox_messages)
    participant SQS as AWS SQS (LocalStack)

    par Busca Concorrente
        W1->>DB: SELECT ... FOR UPDATE SKIP LOCKED (LIMIT 5)
        W2->>DB: SELECT ... FOR UPDATE SKIP LOCKED (LIMIT 5)
    and
        DB-->>W1: Retorna Mensagens [1..5] (Travadas para W1)
        DB-->>W2: Retorna Mensagens [6..10] (Linhas 1..5 ignoradas)
    end

    par Publicação Paralela
        W1->>SQS: Envia Mensagens [1..5]
        W2->>SQS: Envia Mensagens [6..10]
    and
        W1->>DB: UPDATE outbox_messages SET published_at = NOW() WHERE id IN [1..5]
        W2->>DB: UPDATE outbox_messages SET published_at = NOW() WHERE id IN [6..10]
    end
```

### 4. Alinhamento com Clean Architecture & DDD
* **Camada**: `Infrastructure Layer` (`src/infrastructure/`) e `Integration Test Layer` (`test/integration/`).
* **Isolamento**: O Domínio e a Aplicação não conhecem os detalhes de SQL, dialeto PostgreSQL ou comandos SQS. A infraestrutura implementa as portas de persistência respeitando rigorosamente as interfaces definidas na aplicação.

---

## SEÇÃO 2: USER GUIDE & MANUAL DE OPERAÇÃO

### 1. Como Executar e Testar

#### Pré-requisitos:
Para rodar a suíte completa de integração contra instâncias reais, inicie os contêineres Docker:

```bash
# Inicia o PostgreSQL e o LocalStack em segundo plano
docker compose up -d

# Aguarda os contêineres estarem prontos (healthcheck)
docker compose ps
```

#### Executando os Testes de Integração:
```bash
# Executa todos os testes de integração do banco e workers
bun test test/integration/

# Executa testes específicos de restrição de schema
bun test test/integration/schema-constraints.spec.ts

# Executa testes concorrentes do Outbox Relayer
bun test test/integration/outbox-relayer.spec.ts
```

> [!NOTE]
> Se o contêiner do PostgreSQL não estiver ativo no ambiente (ex: máquina sem daemon do Docker instalado), o helper de testes detecta a indisponibilidade e pula a suíte exibindo aviso amigável, garantindo que o pipeline de testes unitários permaneça verde.

### 2. Exemplo de Uso Prático

```ts
import { SQL } from "bun";
import { OutboxRelayerWorker } from "./src/infrastructure/workers/outbox-relayer.worker";

const sql = new SQL("postgres://postgres:postgrespassword@localhost:5432/wagering");

// Instanciação do worker com publicador conectado ao LocalStack SQS
const relayerWorker = new OutboxRelayerWorker(sql, {
  publish: async (eventType, payload) => {
    console.log(`[SQS Publisher] Disparando evento ${eventType}`, payload);
  }
});

// Processa lote de até 20 mensagens com SKIP LOCKED seguro
const processedBatch = await relayerWorker.processBatch(20);
console.log(`Processadas ${processedBatch.length} mensagens.`);
```

### 3. Guia de Resolução de Problemas (Troubleshooting)

| Erro / Situação | Causa Provável | Como Resolver |
|---|---|---|
| `new row for relation "wallets" violates check constraint "check_positive_balance"` | Tentativa de debitar saldo além do zero ou inserir valor negativo diretamente via SQL. | A aplicação nunca deve enviar débito que supere o saldo. Se forçar via SQL, a constraint agiu corretamente protegendo a integridade. |
| `duplicate key value violates unique constraint "uk_wallets_player_currency"` | Tentativa de criar uma segunda carteira para o mesmo jogador com a mesma moeda. | Buscar a carteira existente em vez de criar uma duplicada. Apenas 1 carteira por `(playerId, currency)` é permitida. |
| `duplicate key value violates unique constraint "uk_wager_provider_external"` | Provedor reenviou o mesmo `externalTransactionId` para uma nova transação. | Tratar como duplicata ou consultar a transação previamente existente. |
| Conexão recusada em `localhost:5432` | O contêiner PostgreSQL não foi iniciado ou a porta está ocupada. | Executar `docker compose up -d` e verificar se a porta 5432 está livre no host. |
