# Módulo de Mensageria Assíncrona com AWS SQS e Padrão Inbox

## SEÇÃO 1: ENGENHARIA DE SOFTWARE (Technical Specification)

### 1. Visão Geral e Responsabilidades do Consumidor

O módulo de mensageria assíncrona (`src/infrastructure/messaging/`) implementa o consumidor de alta resiliência e concorrência para a fila **AWS SQS FIFO** (`wager-transactions.fifo`), simulada localmente via **LocalStack**.

Seguindo as diretrizes de **Clean Architecture** e **Domain-Driven Design (DDD)**, o worker atua como um adaptador de entrada primário assíncrono (driven adapter), delegando o processamento das transações de aposta diretamente para o [`ProcessWagerTransactionUseCase`](file:///d:/lucas/Projetos/backend-challenge/src/application/use-cases/process-wager-transaction.use-case.ts), reutilizando 100% da lógica e das invariantes financeiras aplicadas no canal HTTP.

#### Responsabilidades Principais:

1. **Consumo Confiável via SQS FIFO:**
   - Polling contínuo utilizando o comando `ReceiveMessageCommand` com parâmetros configuráveis de _long polling_ (`WaitTimeSeconds: 10 a 20`) e lote (`MaxNumberOfMessages: 1 a 10`).
   - Processamento resiliente com ordenação por grupo (`MessageGroupId`) e tolerância a redelivery (_at-least-once delivery_).
2. **Deduplicação Atômica com Padrão Inbox Persistente:**
   - Prevenção absoluta de duplicação financeira através da persistência do registro da mensagem na tabela física `inbox_messages` do PostgreSQL sob a chave composta `(consumer_name, message_id)`.
   - Se uma mensagem duplicada for recebida e já constar no Inbox, ela sofre **ACK imediato** (`DeleteMessageCommand`) sem acionar novamente o caso de uso.
3. **Garantia de Confirmação Estrita Pós-Commit (Invariante Inviolável):**
   - O comando `DeleteMessageCommand` (ACK) na fila principal **NUNCA** é emitido antes que a transação SQL atômica (Wallet + Ledger + Inbox + Outbox) seja confirmada no PostgreSQL (`COMMIT`).
4. **Graceful Shutdown:**
   - Interrupção coordenada via sinais `SIGINT` e `SIGTERM`, aguardando a finalização das mensagens em processamento e devolvendo a visibilidade (`VisibilityTimeout: 0`) para mensagens interrompidas em voo.

---

### 2. Estratégia de Deduplicação e Classificação de Falhas

O consumidor classifica os cenários de execução em quatro categorias estritas:

| Categoria             | Cenário / Gatilho                                                                      | Ação no Banco / Domínio                         | Ação no SQS                                                            |
| :-------------------- | :------------------------------------------------------------------------------------- | :---------------------------------------------- | :--------------------------------------------------------------------- |
| **Sucesso**           | Transação válida e aplicada (`BET`, `WIN`, etc.)                                       | Commit de Wallet, Ledger, Inbox e Outbox        | `DeleteMessageCommand` (ACK)                                           |
| **Deduplicação**      | `(consumer_name, message_id)` já existe no Inbox                                       | Nenhuma ação (read-only)                        | `DeleteMessageCommand` (ACK)                                           |
| **Erro de Negócio**   | Saldo insuficiente, transação `PENDING_REFERENCE` ou violação de regra (`DomainError`) | Transação rejeitada registrada no domínio       | `DeleteMessageCommand` (ACK)                                           |
| **Falha Transitória** | Timeout de banco de dados, deadlock ou indisponibilidade temporária                    | Rollback SQL completo (Inbox e saldo intocados) | `ChangeMessageVisibilityCommand` (Backoff exponencial)                 |
| **Exaustão / DLQ**    | `ApproximateReceiveCount >= maxRetries` (padrão: 5) ou mensagem malformada             | Rollback SQL completo                           | `SendMessageCommand` na DLQ + `DeleteMessageCommand` na fila principal |

---

### 3. Diagrama de Sequência do Ciclo de Vida da Mensagem

O fluxo a seguir ilustra a sequência atômica desde o recebimento do SQS até a confirmação no PostgreSQL e ACK no broker:

```mermaid
sequenceDiagram
    autonumber
    participant SQS as AWS SQS FIFO (LocalStack)
    participant Worker as SqsConsumerWorker
    participant DTO as Parser & Validador DTO
    participant Inbox as Tabela inbox_messages
    participant UoW as SQL Transaction (Unit of Work)
    participant UseCase as ProcessWagerTransactionUseCase
    participant DLQ as Fila wager-transactions-dlq.fifo

    SQS ->> Worker: ReceiveMessageCommand()
    alt Mensagem recebida
        Worker ->> DTO: parseAndValidateWagerMessage(body)
        alt JSON inválido ou esquema violado
            DTO -->> Worker: MalformedMessageError
            Worker ->> DLQ: SendMessageCommand()
            Worker ->> SQS: DeleteMessageCommand() (Descarte)
        else DTO válido
            Worker ->> Inbox: exists(consumerName, messageId)
            alt Já processada (Deduplicação)
                Inbox -->> Worker: true
                Worker ->> SQS: DeleteMessageCommand() (ACK imediato)
            else Não processada
                alt ApproximateReceiveCount >= maxRetries
                    Worker ->> DLQ: SendMessageCommand()
                    Worker ->> SQS: DeleteMessageCommand()
                else Tentativa válida
                    Worker ->> UoW: execute(transaction)
                    activate UoW
                    UoW ->> UseCase: execute(ProcessWagerTransactionInput)
                    alt Sucesso ou Rejeição de Negócio
                        UseCase -->> UoW: resultado
                        UoW ->> Inbox: INSERT INTO inbox_messages
                        UoW -->> Worker: COMMIT SQL
                        deactivate UoW
                        Worker ->> SQS: DeleteMessageCommand() (ACK pós-commit)
                    else Falha Transitória (ex: DB Timeout)
                        UoW -->> Worker: ROLLBACK SQL
                        deactivate UoW
                        Worker ->> SQS: ChangeMessageVisibilityCommand(backoff)
                    end
                end
            end
        end
    end
```

---

## SEÇÃO 2: USER GUIDE & MANUAL DE OPERAÇÃO

### 1. Comandos de Execução e Verificação de Testes

Os testes da camada de mensageria assíncrona foram construídos com o runner nativo do Bun (`bun:test`) e executam de forma isolada, rápida e sem necessidade de LocalStack externo ativo para a suíte unitária:

#### Executar Suíte de Testes da Mensageria:

```bash
bun test tests/infrastructure/messaging/
```

Saída esperada:

```text
bun test v1.4.4

tests/infrastructure/messaging/sqs-consumer.spec.ts:
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 1: Processamento bem-sucedido de mensagem BET invocando ProcessWagerTransactionUseCase e executando DeleteMessageCommand
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 2: Deduplicação de mensagem já existente no Inbox (deve fazer ack sem chamar o use case novamente)
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 3: Tratamento de erro de negócio (rejeição de aposta) confirmando que a mensagem sofre ack no broker
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 3.1: Tratamento de erro de domínio lançado como exceção (DomainError) confirmando que sofre ack no broker
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 4: Tratamento de erro transitório comprovando que o DeleteMessageCommand NÃO é disparado
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 5: Encaminhamento para DLQ após atingir limite de tentativas
(pass) SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox > Teste 6: Descarte de mensagem malformada com encaminhamento imediato para DLQ e ACK

 7 pass
 0 fail
```

#### Executar Verificação de Tipos TypeScript (`verbatimModuleSyntax`):

```bash
bun run typecheck
```

---

### 2. Variáveis de Ambiente e Configuração

Para conectar o `SqsConsumerWorker` ao LocalStack ou AWS em ambiente local/produção:

| Variável                | Descrição                        | Padrão LocalStack                                                |
| :---------------------- | :------------------------------- | :--------------------------------------------------------------- |
| `AWS_ENDPOINT_URL`      | Endpoint da API do AWS SQS       | `http://localhost:4566`                                          |
| `AWS_REGION`            | Região AWS                       | `us-east-1`                                                      |
| `AWS_ACCESS_KEY_ID`     | Chave de acesso AWS              | `test`                                                           |
| `AWS_SECRET_ACCESS_KEY` | Segredo de acesso AWS            | `test`                                                           |
| `SQS_QUEUE_URL`         | URL da fila principal SQS FIFO   | `http://localhost:4566/000000000000/wager-transactions.fifo`     |
| `SQS_DLQ_URL`           | URL da fila de Dead-Letter (DLQ) | `http://localhost:4566/000000000000/wager-transactions-dlq.fifo` |
| `DATABASE_URL`          | Conexão PostgreSQL               | `postgres://postgres:postgrespassword@localhost:5432/wagering`   |

---

### 3. Guia de Resolução de Problemas (Troubleshooting)

1. **Mensagens Presas em Voo (_Messages in Flight_):**
   - **Sintoma:** As mensagens são recebidas, mas não sofrem ACK e permanecem invisíveis na fila.
   - **Diagnóstico:** O worker sofreu uma falha transitória ou o processo foi encerrado abruptamente sem executar graceful shutdown.
   - **Solução:** O SQS restaurará a visibilidade automaticamente após o término do `VisibilityTimeout`. No encerramento com `SIGINT`/`SIGTERM`, o worker redefine o timeout para `0` imediatamente.
2. **Fila de Dead-Letter (`wager-transactions-dlq.fifo`) Crescendo:**
   - **Sintoma:** Mensagens acumuladas na fila de DLQ.
   - **Diagnóstico:** Ocorreram mensagens com payload malformado (erros de schema no DTO) ou erros de infraestrutura sucessivos excedendo o limite de tentativas (`ApproximateReceiveCount >= 5`).
   - **Solução:** Inspecionar os atributos e o corpo das mensagens na DLQ via AWS CLI:
     ```bash
     aws --endpoint-url=http://localhost:4566 sqs receive-message --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo
     ```
3. **Múltiplos Workers Consumindo Concorrentemente:**
   - **Sintoma:** Disputa entre instâncias do worker pela mesma mensagem.
   - **Diagnóstico:** O SQS FIFO garante exclusividade de entrega por grupo de mensagens (`MessageGroupId`). Caso ocorra entrega duplicada (_at-least-once_), a chave composta `(consumer_name, message_id)` no `inbox_messages` rejeitará a execução concorrente por chave primária no banco.
