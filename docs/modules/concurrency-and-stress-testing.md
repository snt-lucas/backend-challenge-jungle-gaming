# Módulo: Testes de Estresse, Concorrência Real e Integração com Docker (`tests/integration`, `tests/concurrency`, `tests/helpers`)

---

## SEÇÃO 1: ENGENHARIA DE SOFTWARE (Technical Specification)

### 1. Visão Geral e Responsabilidade
Este módulo reúne a suíte de testes de **Integração Real e Concorrência Extrema** com instâncias ativas do PostgreSQL 16 e LocalStack SQS via Docker Compose, atendendo estritamente às Seções 8 e 13 da especificação técnica oficial.

Sua responsabilidade primordial é provar que sob rajadas concorrentes de alta densidade (`Promise.all` com dezenas a centenas de threads simultâneas):
1. **Prevenção de Lost Updates e Deadlocks:** O mecanismo de bloqueio pessimista (`SELECT ... FOR UPDATE`) serializa as mutações por `walletId`.
2. **Invariante Matemática Obrigatória do Ledger:**
   $$\text{Wallet.balance} \equiv \text{initialBalance} - \sum_{\text{DEBIT}} \text{Ledger.money} + \sum_{\text{CREDIT}} \text{Ledger.money}$$
3. **Atomicidade Transacional ACID:** A carteira (`wallets`), o razão contábil (`wallet_ledger_entries`), o inbox de mensageria (`inbox_messages`) e a transactional outbox (`outbox_messages`) são commitados ou revertidos em conjunto (`ROLLBACK`).
4. **Idempotência Concorrente Real:** 50 requisições simultâneas com a mesma `idempotencyKey` resultam em exatamente 1 débito no banco e 49 replays marcados com `idempotentReplay: true`.
5. **Garantia de Não-Duplicação na Outbox:** Múltiplos workers `OutboxRelayerWorker` concorrentes competem usando `SELECT ... FOR UPDATE SKIP LOCKED` sem colisão ou duplicação de eventos.

---

### 2. Helper de Infraestrutura Real (`tests/helpers/test-database.helper.ts`)

O `TestDatabaseHelper` é o adaptador canônico para a base de dados PostgreSQL real:

- **Conexão Nativa:** Utiliza o driver de alta performance `SQL` nativo do Bun (`postgres://postgres:postgrespassword@localhost:5432/wagering`).
- **Detecção Resiliente:** Método `checkAvailability()` verifica se a porta 5432 responde dentro de 1500ms. Se o contêiner não estiver ativo na estação de desenvolvimento, os testes exibem aviso claro e passam sem quebrar o CI.
- **Isolamento Determinístico (`cleanDatabase`):**
  ```sql
  TRUNCATE TABLE 
    wallet_ledger_entries,
    wager_transactions,
    wallets,
    inbox_messages,
    outbox_messages
  CASCADE;
  ```
- **Validador Contábil Canônico (`assertLedgerInvariant`):**
  Lê a carteira e todos os lançamentos do ledger ordenados por `created_at ASC`. Compara o saldo final da carteira com o saldo reconstruído via `Money.equals()` e valida que cada lançamento respeita `check_ledger_equation`.

---

### 3. Cenários de Concorrência e Integração Comprovados

#### A. Cenário Obrigatório do Desafio (Seção 8 do README)
- **Cenário:** Carteira com saldo inicial de 100.00 BRL e duas apostas simultâneas de 80.00 BRL submetidas em paralelo.
- **Resultado Comprovado:**
  * Exatamente 1 aposta processada (`PROCESSED`).
  * Exatamente 1 aposta rejeitada por saldo insuficiente (`REJECTED` com `FailureCode.InsufficientFunds`).
  * Saldo final da carteira: exatamente 20.00 BRL (2000 centavos).
  * Exatamente 1 lançamento de débito no ledger.
  * Invariante contábil válida.

#### B. Contenção Massiva de 50 Apostas Idênticas em Paralelo
- **Cenário:** Carteira com 100.00 BRL recebe 50 chamadas concorrentes com a mesma `idempotencyKey` e payload idêntico de aposta de 10.00 BRL.
- **Resultado Comprovado:**
  * Exatamente 1 aposta processada como original.
  * Exatamente 49 respostas marcadas com `idempotentReplay: true`.
  * Saldo final: 90.00 BRL.
  * Exatamente 1 lançamento no razão (sem duplicação de débitos).
  * Invariante contábil válida.

#### C. Disputa Concorrente de Múltiplas Instâncias ("Hot Wallet")
- **Cenário:** 100 apostas concorrentes de 10.00 BRL disputando uma carteira de 300.00 BRL entre 3 instâncias de workers.
- **Resultado Comprovado:**
  * Exatamente 30 apostas `PROCESSED` e 70 apostas `REJECTED`.
  * Saldo final rigorosamente 0.00 BRL.
  * Exatamente 30 lançamentos no ledger totalizando 300.00 BRL.
  * Zero deadlocks.

#### D. Atomicidade ACID e Crash Recovery Simulado
- **Commit Atômico:** Validação de que `wallets`, `wallet_ledger_entries`, `inbox_messages` e `outbox_messages` gravam simultaneamente no banco.
- **Rollback Transacional:** Simulação de interrupção antes do commit desfaz 100% das alterações.
- **Crash Recovery no SQS:** Reenvio de mensagem com mesmo `messageId` após queda simulada é retido pela chave primária composta `(consumer_name, message_id)` em `inbox_messages`.
- **Worker SKIP LOCKED:** Dois workers `OutboxRelayerWorker` disputando 20 eventos publicam rigorosamente 20 mensagens sem duplicidade.

---

## SEÇÃO 2: GUIA DE EXECUÇÃO E TESTES (Operations Manual)

### Comandos de Teste no Terminal

```bash
# Execução da suíte de concorrência extrema
bun test tests/concurrency/

# Execução da suíte de integração com PostgreSQL e SQS
bun test tests/integration/

# Execução conjunta de concorrência e integração
bun test tests/concurrency/ tests/integration/

# Suíte completa de testes do Backend Challenge (164 testes)
bun test
```
