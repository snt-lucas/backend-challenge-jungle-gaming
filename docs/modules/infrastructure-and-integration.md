# Módulo: Infraestrutura, Transactional Outbox e Mensageria (`src/infrastructure`, `test/integration`, `tests/infrastructure/messaging`)

---

## SEÇÃO 1: ENGENHARIA DE SOFTWARE (Technical Specification)

### 1. Visão Geral e Responsabilidade

O módulo de Infraestrutura provê adaptadores de persistência e orquestração de banco de dados PostgreSQL real, migrações de schema com integridade referencial, e publicação concreta de eventos gerados pelo padrão **Transactional Outbox** conectando-se ao **AWS SQS FIFO via LocalStack**.

Sua responsabilidade é garantir a consistência das transações financeiras ACID, execução de bloqueios pessimistas (`SELECT ... FOR UPDATE`), concorrência distribuída com `SKIP LOCKED`, além da serialização estável e publicação confiável de eventos de integração sem risco de perda ou duplicação.

### 2. Motivação e Justificativa (Por que existe?)

Em processadores financeiros distribuídos de alta concorrência:

- **Invariante Pós-Commit:** A publicação de eventos para outros serviços (ou brokers externos) **NUNCA** pode ocorrer antes do commit da transação financeira no banco de dados. Caso contrário, se o processo falhar durante o commit, eventos seriam propagados sobre dados inexistentes no banco.
- **Tolerância a Falhas do Broker:** O PostgreSQL atua como buffer persistente na tabela `outbox_messages`. Se a rede ou o AWS SQS oscilarem, o evento permanece registrado com `published_at IS NULL` e agendamento de retry com backoff exponencial (`next_attempt_at`).
- **Concorrência Horizontal com `SKIP LOCKED`:** Múltiplas instâncias do `OutboxRelayerWorker` executam varreduras em lote simultâneas com `SELECT ... FOR UPDATE SKIP LOCKED`, garantindo que nenhuma mensagem seja processada em duplicidade ou bloqueie outras instâncias.
- **Ordenação e Deduplicação em SQS FIFO:** A integração do `OutboxSqsPublisher` com filas FIFO utiliza `MessageGroupId = aggregateId` (garantindo ordem causal estrita por carteira) e `MessageDeduplicationId = eventId` (prevenindo duplicação no transporte).

---

### 3. Hierarquia de Eventos de Integração e Envelopes

A camada de domínio (`src/domain/events/`) define uma hierarquia de tipos fortemente tipada com base na classe abstrata `IntegrationEvent<T>`. O `eventType` e a `version` residem no **tipo** da subclasse (não em strings soltas no call site).

```typescript
abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  toJSON(): SerializedIntegrationEvent<T>;
}
```

#### As 4 Subclasses Concretas Mínimas Exigidas:

1. **`WagerTransactionProcessed` (version: 1):** Disparado em qualquer transação aplicada, inclusive `LOSS`. Contém dados da aposta, carteira e novo saldo em `MoneyProps`.
2. **`WagerTransactionRejected` (version: 1):** Disparado quando a transação for recusada por regra de negócio (saldo insuficiente, etc.), contendo o `FailureCode` auditável.
3. **`WalletBalanceChanged` (version: 1):** Disparado **estritamente** quando o saldo da carteira é modificado, contendo `balanceBefore`, `balanceAfter`, `money`, `direction` e `walletVersion`.
4. **`WagerTransactionPendingReference` (version: 1):** Disparado quando uma operação de estorno (`REFUND` ou `ROLLBACK`) chega antes da aposta original referenciada.

> [!IMPORTANT]
> O payload de evento (`data`) trafega estritamente a interface `MoneyProps` (`{ amount: string, currency: string }`), **nunca** instâncias de classe `Money`. O método `toJSON()` emite `occurredAt` formatado em ISO-8601 UTC.

---

### 4. Componentes do Módulo

| Componente                              | Tipo           | Responsabilidade                                                                                                                                                           |
| --------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IntegrationEvent<T>`                   | Abstract Class | Envelope base estável de eventos de integração com serialização uniforme.                                                                                                  |
| `OutboxSqsPublisher`                    | Adapter        | Conecta ao LocalStack SQS FIFO, configurando `MessageGroupId` e `MessageDeduplicationId`.                                                                                  |
| `OutboxRelayerWorker`                   | Worker         | Lê mensagens pendentes da outbox com `FOR UPDATE SKIP LOCKED`, publica no broker e marca `published_at = NOW()`. Trata erros com backoff exponencial em `next_attempt_at`. |
| `TransactionalWageringProcessorService` | Service        | Executa a transação atômica completa (Wallet, Ledger, Inbox e Outbox) com lock pessimista e ordenação FK correta.                                                          |
| `PendingReferenceTtlWorker`             | Worker         | Monitora e transiciona transações `PENDING_REFERENCE` expiradas para `REJECTED`.                                                                                           |
| `MikroOrmWalletRepository`              | Repository     | Implementação concreta de `WalletRepositoryPort` via `EntityManager` do MikroORM.                                                                                          |
| `MikroOrmWagerTransactionRepository`    | Repository     | Implementação concreta de `WagerTransactionRepositoryPort` via `EntityManager` do MikroORM.                                                                                |
| `MikroOrmWalletLedgerRepository`        | Repository     | Implementação concreta de `WalletLedgerRepositoryPort` via `EntityManager` do MikroORM.                                                                                    |
| `MikroOrmInboxRepository`               | Repository     | Implementação concreta de `InboxRepositoryPort` via `EntityManager` do MikroORM.                                                                                           |
| `MikroOrmUnitOfWork`                    | UnitOfWork     | Implementação de `UnitOfWorkPort` orquestrando transações atômicas nativas do MikroORM.                                                                                    |
| `DatabaseModule`                        | Nest Module    | Módulo `@Global()` exportando conexões e vinculando os Symbols das portas aos repositórios MikroORM.                                                                       |
| `MessagingModule`                       | Nest Module    | Módulo `@Global()` exportando `SQSClient` e `OutboxSqsPublisher`.                                                                                                          |
| `PostgresTestHelper`                    | Test Utility   | Gerencia conexão com Bun SQL, migrações e limpeza de tabelas entre suítes de teste.                                                                                        |

#### Diagrama de Concorrência: Worker Outbox Relayer (`SKIP LOCKED`)

```mermaid
sequenceDiagram
    autonumber
    actor W1 as Worker 1
    actor W2 as Worker 2
    participant DB as PostgreSQL (outbox_messages)
    participant SQS as AWS SQS FIFO (LocalStack)

    par Busca Concorrente
        W1->>DB: SELECT ... FOR UPDATE SKIP LOCKED (LIMIT 5)
        W2->>DB: SELECT ... FOR UPDATE SKIP LOCKED (LIMIT 5)
    and
        DB-->>W1: Retorna Mensagens [1..5] (Travadas para W1)
        DB-->>W2: Retorna Mensagens [6..10] (Linhas 1..5 ignoradas)
    end

    par Publicação Paralela
        W1->>SQS: SendMessageCommand (Group: aggId, Dedup: eventId)
        W2->>SQS: SendMessageCommand (Group: aggId, Dedup: eventId)
    and
        W1->>DB: UPDATE outbox_messages SET published_at = NOW() WHERE id IN [1..5]
        W2->>DB: UPDATE outbox_messages SET published_at = NOW() WHERE id IN [6..10]
    end
```

---

## SEÇÃO 2: USER GUIDE & MANUAL DE OPERAÇÃO

### 1. Comandos de Execução e Verificação de Testes

Os testes cobrem tanto a serialização dos envelopes de domínio quanto o adapter `OutboxSqsPublisher` e a resiliência do `OutboxRelayerWorker`:

#### 1. Executar Testes do Publicador e Eventos:

```bash
bun test tests/infrastructure/messaging/integration-events.spec.ts
bun test tests/infrastructure/messaging/outbox-publisher.spec.ts
```

Saída esperada:

```text
bun test v1.4.4

tests/infrastructure/messaging/integration-events.spec.ts:
(pass) Hierarquia de Eventos de Integração e Serialização de Envelopes > deve criar e serializar WagerTransactionProcessed com envelope estável e MoneyProps
(pass) Hierarquia de Eventos de Integração e Serialização de Envelopes > deve criar e serializar WagerTransactionRejected com failureCode e MoneyProps
(pass) Hierarquia de Eventos de Integração e Serialização de Envelopes > deve criar e serializar WalletBalanceChanged estritamente com MoneyProps e LedgerDirection
(pass) Hierarquia de Eventos de Integração e Serialização de Envelopes > deve criar e serializar WagerTransactionPendingReference quando a referência estiver ausente

tests/infrastructure/messaging/outbox-publisher.spec.ts:
(pass) OutboxSqsPublisher e OutboxRelayerWorker — Publicação e Resiliência de Eventos > OutboxSqsPublisher Adapter > deve publicar evento no SQS FIFO configurando MessageGroupId e MessageDeduplicationId
(pass) OutboxSqsPublisher e OutboxRelayerWorker — Publicação e Resiliência de Eventos > OutboxRelayerWorker — Processamento em Lote e Retry > deve varrer batch, publicar no broker e marcar published_at
(pass) OutboxSqsPublisher e OutboxRelayerWorker — Publicação e Resiliência de Eventos > OutboxRelayerWorker — Processamento em Lote e Retry > deve tratar falha no envio agendando retry com incremento de attempts e backoff
```

#### 2. Executar Toda a Suíte de Mensageria:

```bash
bun test tests/infrastructure/messaging/
```

#### 3. Executar Testes de Concorrência Real com Docker Ativo:

```bash
docker compose up -d
bun test test/integration/outbox-relayer.spec.ts
```

---

### 2. Variáveis de Ambiente e Configuração

| Variável               | Descrição                              | Padrão LocalStack                                              |
| :--------------------- | :------------------------------------- | :------------------------------------------------------------- |
| `AWS_ENDPOINT_URL`     | Endpoint da API do LocalStack          | `http://localhost:4566`                                        |
| `AWS_REGION`           | Região AWS                             | `us-east-1`                                                    |
| `OUTBOX_SQS_QUEUE_URL` | URL da fila FIFO de saída para eventos | `http://localhost:4566/000000000000/wager-transactions.fifo`   |
| `DATABASE_URL`         | String de conexão com o PostgreSQL     | `postgres://postgres:postgrespassword@localhost:5432/wagering` |

---

### 3. Guia de Resolução de Problemas (Troubleshooting)

1. **Eventos Acumulando com `published_at IS NULL` na Outbox:**
   - **Diagnóstico:** O worker do relayer pode estar desligado ou o broker SQS (LocalStack) está temporariamente inacessível.
   - **Verificação:** Checar coluna `attempts` e `next_attempt_at`. Se `attempts > 0`, o worker está aplicando backoff exponencial para retentar a publicação.
   - **Ação:** Verificar a saúde do LocalStack via `docker compose ps` ou `curl http://localhost:4566/_localstack/health`.
2. **Duplicação de Publicação na Rede:**
   - **Diagnóstico:** Instabilidade de rede causou reenvio do comando `SendMessageCommand`.
   - **Solução:** O `OutboxSqsPublisher` configura o `MessageDeduplicationId = eventId`. O próprio broker SQS FIFO descarta mensagens repetidas dentro da janela de deduplicação (5 minutos).
