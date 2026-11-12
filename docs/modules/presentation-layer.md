# Camada de Apresentação HTTP (`presentation-layer`)

## SEÇÃO 1: ENGENHARIA DE SOFTWARE (Technical Specification)

### 1. Visão Geral e Responsabilidade

A camada de apresentação HTTP é a fronteira externa do sistema, responsável por expor as interfaces RESTful para clientes externos (provedores de jogos, backoffices e serviços de monitoramento). Construída sobre o **NestJS** e executada sob o runtime **Bun 1.x**, atua como adaptador primário na Clean Architecture, traduzindo requisições HTTP em DTOs/comandos e delegando a execução para a camada de aplicação (`application-layer`).

#### Responsabilidades Principais:

1. **Contratos HTTP e Roteamento:**
   - Mapeamento explícito de rotas RESTful para gerenciamento de carteiras (`/wallets`), apostas/transações (`/wagering/transactions`) e monitoramento (`/health`).
2. **Idempotência no Transporte HTTP:**
   - Captura mandatória do cabeçalho `Idempotency-Key` em requisições de transação financeira (`POST /wagering/transactions`).
   - Mapeamento de conflitos de payload para o status HTTP `409 Conflict` (`IdempotencyConflictError`).
3. **Mapeamento de Status HTTP Consistente:**
   - `200 OK`: Consultas e reconciliação bem-sucedidas.
   - `201 Created`: Criação de carteiras e submissão inicial de apostas/transações.
   - `404 Not Found`: Entidades não encontradas (`WalletNotFoundError`, transações inexistentes).
   - `409 Conflict`: Conflito de idempotência (mesma chave com payload divergente).
4. **Validação Estrita de Dados:**
   - Validação com `class-validator` e `class-transformer` garantindo formato monetário estrito (string decimal com 2 casas), moedas ISO-4217 em maiúsculas e enumeração correta.

---

### 2. Contratos, Enumeradores e Tipagem Estrita

Em conformidade com a flag `"verbatimModuleSyntax": true` do `tsconfig.json`:

- Todas as importações de interfaces e tipos de portas são realizadas exclusivamente via `import type { ... }`.
- A nomenclatura dos enumeradores do domínio adota PascalCase para membros e SCREAMING_SNAKE_CASE para os valores em string:
  - `LedgerDirection.Credit = "CREDIT"` e `LedgerDirection.Debit = "DEBIT"`
  - `WagerTransactionKind.Opening = "OPENING"`, `WagerTransactionKind.Bet = "BET"`, `WagerTransactionKind.Win = "WIN"`, `WagerTransactionKind.Loss = "LOSS"`, `WagerTransactionKind.Refund = "REFUND"`, `WagerTransactionKind.Rollback = "ROLLBACK"`
  - `WagerTransactionStatus.Pending = "PENDING"`, `WagerTransactionStatus.PendingReference = "PENDING_REFERENCE"`, `WagerTransactionStatus.Processed = "PROCESSED"`, `WagerTransactionStatus.Rejected = "REJECTED"`, `WagerTransactionStatus.Failed = "FAILED"`
  - `FailureCode`: Contém `InsufficientFunds`, `InvalidReference`, `ReferenceTimeout`, `WalletNotFound`, `DuplicateReference`, etc.

---

### 3. Mapeamento de Controladores e Endpoints

#### 3.1. `WagerTransactionController`

- `POST /wagering/transactions`: Submissão de aposta/transação financeira.
  - Header: `@Headers('idempotency-key')` obrigatório.
  - Body: `ProcessWagerTransactionDto`.
  - Respostas: `201 Created` (sucesso), `409 Conflict` (`IdempotencyConflictError`), `404 Not Found` (`WalletNotFoundError`).
- `GET /wagering/transactions/:transactionId`: Busca transação pelo UUID interno.
  - Respostas: `200 OK`, `404 Not Found`.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`: Busca transação pela combinação provedor + ID externo.
  - Respostas: `200 OK`, `404 Not Found`.

#### 3.2. `WalletController`

- `POST /wallets`: Criação de carteira (`CreateWalletDto`).
  - Respostas: `201 Created`, `404 Not Found` (se usuário inválido).
- `GET /wallets/:id`: Consulta saldo e dados cadastrais da carteira.
  - Respostas: `200 OK`, `404 Not Found` (`WalletNotFoundError`).
- `POST /wallets/:walletId/reconciliation`: Reconciliação do saldo da carteira com o somatório dos lançamentos no ledger.
  - Respostas: `200 OK`, `404 Not Found` (`WalletNotFoundError`).
- `GET /wallets/:walletId/ledger`: Extrato paginado com cursor dos lançamentos imutáveis do ledger.
  - Query Params: `cursor?: string`, `limit?: string | number` (tratado com valor padrão `50`).
  - Respostas: `200 OK`, `404 Not Found` (`WalletNotFoundError`).

#### 3.3. `HealthController`

- `GET /health/live`: Verificação de vivacidade (liveness probe).
  - Resposta: `200 OK` com payload `{ status: "UP", timestamp: string }`.
- `GET /health/ready`: Verificação de prontidão (readiness probe), consultando opcionalmente o banco de dados.
  - Resposta: `200 OK` (`status: "UP"`) ou `status: "DOWN"` em caso de falha de conexão.

---

### 4. Arquitetura Modular (`PresentationModule`)

O módulo raiz da camada de apresentação agrega todos os controladores e expõe a interface para inicialização via NestJS:

```typescript
import { Module } from "@nestjs/common";
import { HealthController } from "./http/controllers/health.controller";
import { WagerTransactionController } from "./http/controllers/wager-transaction.controller";
import { WalletController } from "./http/controllers/wallet.controller";

@Module({
  controllers: [HealthController, WagerTransactionController, WalletController],
  providers: [
    CreateWalletUseCase,
    GetWalletUseCase,
    ReconcileWalletUseCase,
    GetWalletLedgerUseCase,
    ProcessWagerTransactionUseCase,
  ],
  exports: [HealthController, WagerTransactionController, WalletController],
})
export class PresentationModule {}
```

---

## SEÇÃO 2: USER GUIDE & MANUAL DE OPERAÇÃO

### 1. Inicialização do Servidor HTTP NestJS

A aplicação é inicializada através da fábrica do NestJS (`NestFactory.create`) utilizando o `PresentationModule`:

```typescript
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { PresentationModule } from "./presentation/presentation.module";

async function bootstrap() {
  const app = await NestFactory.create(PresentationModule);

  // Habilitar validação global baseada em DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`HTTP Server running on port ${port}`);
}

bootstrap();
```

---

### 2. Comandos de Verificação e Testes

Todos os testes são executados com o runtime nativo do Bun (`bun:test`), sem dependências pesadas de jest:

#### 2.1. Execução Exclusiva dos Testes da Camada de Apresentação:

```bash
bun test tests/presentation/http/
```

Saída esperada (100% de aprovação):

```text
bun test v1.4.4

tests/presentation/http/health.controller.spec.ts:
(pass) HealthController > GET /health/live > deve retornar 200 OK com status UP para a verificacao de vivacidade (liveness)
(pass) HealthController > GET /health/ready > deve retornar 200 OK com status UP para a verificacao de prontidao (readiness)
(pass) HealthController > GET /health/ready > deve retornar status DOWN quando a conexao com o banco falhar

tests/presentation/http/wager-transaction.controller.spec.ts:
(pass) WagerTransactionController > POST /wagering/transactions (createWagerTransaction) > deve retornar 201 Created e o resultado em caso de sucesso
(pass) WagerTransactionController > POST /wagering/transactions (createWagerTransaction) > deve lancar HTTP 409 Conflict quando ocorrer IdempotencyConflictError
(pass) WagerTransactionController > POST /wagering/transactions (createWagerTransaction) > deve lancar HTTP 404 Not Found quando ocorrer WalletNotFoundError
(pass) WagerTransactionController > GET /wagering/transactions/:transactionId > deve retornar 200 OK com os dados da transacao quando encontrada
(pass) WagerTransactionController > GET /wagering/transactions/:transactionId > deve lancar HTTP 404 Not Found quando a transacao nao for encontrada
(pass) WagerTransactionController > GET /providers/:providerId/wagering/transactions/:externalTransactionId > deve retornar 200 OK com os dados da transacao por ID externo
(pass) WagerTransactionController > GET /providers/:providerId/wagering/transactions/:externalTransactionId > deve lancar HTTP 404 Not Found quando a transacao externa nao for encontrada

tests/presentation/http/wallet.controller.spec.ts:
(pass) WalletController > POST /wallets (createWallet) > deve retornar 201 Created com a carteira criada
(pass) WalletController > POST /wallets (createWallet) > deve lancar HTTP 404 Not Found se o usuario da carteira nao for encontrado
(pass) WalletController > GET /wallets/:id (getWalletById) > deve retornar 200 OK com os dados da carteira
(pass) WalletController > GET /wallets/:id (getWalletById) > deve lancar HTTP 404 Not Found se a carteira nao existir
(pass) WalletController > POST /wallets/:walletId/reconciliation (reconcileWallet) > deve retornar 200 OK com status de sucesso na reconciliacao
(pass) WalletController > POST /wallets/:walletId/reconciliation (reconcileWallet) > deve lancar HTTP 404 Not Found se a carteira nao for encontrada na reconciliacao
(pass) WalletController > GET /wallets/:walletId/ledger (getWalletLedger) > deve retornar 200 OK com a lista de lancamentos do ledger
(pass) WalletController > GET /wallets/:walletId/ledger (getWalletLedger) > deve usar limit padrao 50 quando limit nao for fornecido
(pass) WalletController > GET /wallets/:walletId/ledger (getWalletLedger) > deve lancar HTTP 404 Not Found se a carteira nao for encontrada no ledger

 19 pass
 0 fail
```

#### 2.2. Verificação de Tipos TypeScript (`verbatimModuleSyntax`):

```bash
bun run typecheck
```

#### 2.3. Execução de Toda a Suíte de Testes do Projeto:

```bash
bun test
```

(119 pass, 0 fail)

---

### 3. Guia de Resolução de Problemas (Troubleshooting)

1. **Erro `IdempotencyConflictError` (HTTP 409):**
   - **Causa:** O cliente reenviou o cabeçalho `Idempotency-Key` associado a um payload com hash divergente do anterior.
   - **Solução:** O cliente deve gerar um novo `Idempotency-Key` para requisições com dados alterados (valor, moeda, rodada). Se for um reenvio idêntico de rede, deve manter o mesmo payload para receber `idempotentReplay: true`.

2. **Erro `WalletNotFoundError` (HTTP 404):**
   - **Causa:** O `walletId` informado na URL ou no corpo da requisição não existe na base de dados.
   - **Solução:** Criar a carteira previamente via `POST /wallets` ou verificar se o identificador UUID está correto.

3. **Validação de Valor Monetário (HTTP 400 Bad Request):**
   - **Causa:** O campo `amount` foi enviado como número (`100.5`) ou string sem duas casas decimais (`"100.5"`).
   - **Solução:** Enviar estritamente no formato string com 2 casas decimais: `"100.50"`.
