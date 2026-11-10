import { beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { ProcessWagerTransactionInput } from "../../src/application/dtos/process-wager-transaction.dto";
import { WalletLedgerRepositoryPort } from "../../src/application/ports/wallet-ledger.repository.port";
import { WalletRepositoryPort } from "../../src/application/ports/wallet.repository.port";
import { WagerTransactionRepositoryPort } from "../../src/application/ports/wager-transaction.repository.port";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { Wallet } from "../../src/domain/entities/wallet.aggregate";
import { WalletLedgerEntry } from "../../src/domain/entities/wallet-ledger-entry.entity";
import { WagerTransaction } from "../../src/domain/entities/wager-transaction.entity";
import { FailureCode } from "../../src/domain/enums/failure-code.enum";
import { LedgerDirection } from "../../src/domain/enums/ledger-direction.enum";
import { WagerTransactionKind } from "../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/domain/enums/wager-transaction-status.enum";
import { Money } from "../../src/domain/value-objects/money.vo";
import { PostgresTestHelper } from "../../src/infrastructure/database/postgres-test-helper";
import { MemoryPessimisticLockAdapter } from "../../src/infrastructure/locking/memory-pessimistic-lock.adapter";

describe("E2E Concorrência e Estresse: 150 Apostas Concorrentes (Promise.all)", () => {
  let wallets: Map<string, Wallet>;
  let wagerTransactions: Map<string, WagerTransaction>;
  let ledgerEntries: WalletLedgerEntry[];

  let walletRepo: WalletRepositoryPort;
  let wagerTxRepo: WagerTransactionRepositoryPort;
  let ledgerRepo: WalletLedgerRepositoryPort;
  let lockAdapter: MemoryPessimisticLockAdapter;
  let useCase: ProcessWagerTransactionUseCase;

  const walletId = "wallet-concurrency-target";
  const playerId = "player-high-concurrency";
  const providerId = "pragmatic-play";

  beforeEach(() => {
    wallets = new Map();
    wagerTransactions = new Map();
    ledgerEntries = [];

    walletRepo = {
      findById: async (id: string) => wallets.get(id) ?? null,
      save: async (wallet: Wallet) => {
        wallets.set(wallet.id, wallet);
      },
    };

    wagerTxRepo = {
      findById: async (id: string) => wagerTransactions.get(id) ?? null,
      findByIdempotencyKey: async (key: string) => {
        for (const tx of wagerTransactions.values()) {
          if (tx.idempotencyKey === key) return tx;
        }
        return null;
      },
      findByProviderAndExternalId: async (pId: string, extId: string) => {
        for (const tx of wagerTransactions.values()) {
          if (tx.providerId === pId && tx.externalTransactionId === extId) {
            return tx;
          }
        }
        return null;
      },
      save: async (tx: WagerTransaction) => {
        wagerTransactions.set(tx.id, tx);
      },
    };

    ledgerRepo = {
      save: async (entry: WalletLedgerEntry) => {
        ledgerEntries.push(entry);
      },
      findByWalletId: async (wId: string) => {
        return ledgerEntries.filter((e) => e.walletId === wId);
      },
    };

    lockAdapter = new MemoryPessimisticLockAdapter();
    useCase = new ProcessWagerTransactionUseCase(
      walletRepo,
      wagerTxRepo,
      ledgerRepo,
      lockAdapter,
    );
  });

  it("deve processar exatamente 30 apostas de 10.00 BRL com sucesso zerando a carteira e rejeitar 120 por saldo insuficiente sem deadlocks", async () => {
    // 1. Criar carteira com saldo inicial de 300.00 BRL para suportar exatamente 30 apostas de 10.00 BRL
    const initialBalance = Money.from({ amount: "300.00", currency: "BRL" });
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance,
    });
    wallets.set(walletId, wallet);

    // 2. Disparar simultaneamente via Promise.all() 150 requisições paralelas de BET de 10.00 BRL com Idempotency-Keys distintas
    const totalRequests = 150;
    const betAmount = { amount: "10.00", currency: "BRL" };

    const requests: Promise<ReturnType<typeof useCase.execute>>[] = [];

    for (let i = 0; i < totalRequests; i++) {
      const extId = `ext-bet-${i.toString().padStart(3, "0")}`;
      const input: ProcessWagerTransactionInput = {
        idempotencyKey: `${providerId}:${extId}`,
        providerId,
        externalTransactionId: extId,
        playerId,
        walletId,
        roundId: `round-${Math.floor(i / 10)}`,
        gameId: "sweet-bonanza-1000",
        kind: WagerTransactionKind.Bet,
        money: betAmount,
      };

      requests.push(useCase.execute(input));
    }

    // Disparo verdadeiramente concorrente
    const results = await Promise.all(requests);

    // 3. Verificações de concorrência e integridade de negócio
    const processedTxs = results.filter(
      (r) => r.status === WagerTransactionStatus.Processed,
    );
    const rejectedTxs = results.filter(
      (r) =>
        r.status === WagerTransactionStatus.Rejected &&
        r.failureCode === FailureCode.InsufficientFunds,
    );

    expect(results.length).toBe(150);
    expect(processedTxs.length).toBe(30);
    expect(rejectedTxs.length).toBe(120);

    // Carteira teve seu saldo zerado exatamente
    const finalWallet = await walletRepo.findById(walletId);
    expect(finalWallet).toBeDefined();
    expect(finalWallet!.balance.amount).toBe("0.00");
    expect(finalWallet!.balance.isZero()).toBe(true);

    // Versão da wallet incrementou exatamente 30 vezes (de 1 para 31)
    expect(finalWallet!.version).toBe(31);

    // 4. Asserção da Invariante Matemática Absoluta:
    // Wallet.balance deve ser exatamente igual ao saldo inicial subtraído da soma dos débitos no ledger
    expect(ledgerEntries.length).toBe(30);

    let sumLedgerDebits = Money.zero("BRL");
    for (const entry of ledgerEntries) {
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.isBalanced()).toBe(true);
      sumLedgerDebits = sumLedgerDebits.add(entry.money);
    }

    // A soma dos lançamentos de débito deve ser exatamente 300.00 BRL
    expect(sumLedgerDebits.amount).toBe("300.00");

    // Invariante: initialBalance - SUM(ledgerEntries) === finalWallet.balance
    const reconstructedBalance = initialBalance.subtract(sumLedgerDebits);
    expect(reconstructedBalance.equals(finalWallet!.balance)).toBe(true);
    expect(finalWallet!.balance.amount).toBe("0.00");
  });

  it("deve respeitar a concorrência e invariante para saldo inicial de 100.00 BRL (10 apostas processadas e 140 rejeitadas)", async () => {
    // Cenário com saldo inicial estritamente 100.00 BRL
    const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });
    const targetWallet = Wallet.open({
      id: "wallet-100-test",
      playerId,
      initialBalance,
    });
    wallets.set("wallet-100-test", targetWallet);

    const totalRequests = 150;
    const betAmount = { amount: "10.00", currency: "BRL" };

    const requests = Array.from({ length: totalRequests }, (_, i) => {
      const extId = `ext-tx-100-${i}`;
      return useCase.execute({
        idempotencyKey: `prov-100:${extId}`,
        providerId: "prov-100",
        externalTransactionId: extId,
        playerId,
        walletId: "wallet-100-test",
        roundId: `round-${i}`,
        gameId: "gates-of-olympus",
        kind: WagerTransactionKind.Bet,
        money: betAmount,
      });
    });

    const results = await Promise.all(requests);

    const processed = results.filter(
      (r) => r.status === WagerTransactionStatus.Processed,
    );
    const rejected = results.filter(
      (r) => r.status === WagerTransactionStatus.Rejected,
    );

    expect(processed.length).toBe(10);
    expect(rejected.length).toBe(140);

    const updatedWallet = await walletRepo.findById("wallet-100-test");
    expect(updatedWallet!.balance.amount).toBe("0.00");
    expect(updatedWallet!.version).toBe(11); // 1 + 10 atualizações
  });

  describe("Concorrência Real no PostgreSQL (quando contêiner ativo)", () => {
    const db = PostgresTestHelper.getInstance();
    let isDbAvailable = false;

    it("deve rodar concorrência real com SELECT ... FOR UPDATE no PostgreSQL quando o contêiner estiver online", async () => {
      isDbAvailable = await db.checkAvailability();
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      await db.runMigrations();
      await db.truncateAll();

      const pgWalletId = randomUUID();
      const pgPlayerId = randomUUID();

      // Saldo inicial 300.00 BRL no PostgreSQL
      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${pgWalletId}, ${pgPlayerId}, 'BRL', 30000, 1)
      `;

      // 150 transações concorrentes reais no PostgreSQL
      const concurrencyRequests = Array.from({ length: 150 }, async (_, i) => {
        return await db.sql.begin(async (tx) => {
          const [w] = await tx`
            SELECT id, balance_cents, version
            FROM wallets
            WHERE id = ${pgWalletId}
            FOR UPDATE
          `;

          const balance = BigInt(w.balance_cents);
          const betCents = 1000n; // 10.00 BRL

          if (balance < betCents) {
            return { status: "REJECTED", reason: "INSUFFICIENT_FUNDS" };
          }

          const newBalance = balance - betCents;
          await tx`
            UPDATE wallets
            SET balance_cents = ${newBalance.toString()}, version = version + 1
            WHERE id = ${pgWalletId}
          `;

          const txId = randomUUID();
          await tx`
            INSERT INTO wager_transactions (
              id, provider_id, external_transaction_id, idempotency_key, payload_hash,
              wallet_id, player_id, round_id, game_id, kind, amount_cents, currency, status
            ) VALUES (
              ${txId}, 'pg-prov', ${`pg-ext-${i}`}, ${`pg-idemp-${i}`}, 'h',
              ${pgWalletId}, ${pgPlayerId}, 'r', 'g', 'BET', 1000, 'BRL', 'PROCESSED'
            )
          `;

          await tx`
            INSERT INTO wallet_ledger_entries (
              id, wallet_id, transaction_id, direction, amount_cents,
              currency, balance_before_cents, balance_after_cents
            ) VALUES (
              ${randomUUID()}, ${pgWalletId}, ${txId}, 'DEBIT', 1000,
              'BRL', ${balance.toString()}, ${newBalance.toString()}
            )
          `;

          return { status: "PROCESSED" };
        });
      });

      const pgResults = await Promise.all(concurrencyRequests);

      const pgProcessed = pgResults.filter((r) => r.status === "PROCESSED");
      const pgRejected = pgResults.filter((r) => r.status === "REJECTED");

      expect(pgProcessed.length).toBe(30);
      expect(pgRejected.length).toBe(120);

      const [finalPgWallet] = await db.sql`
        SELECT balance_cents, version FROM wallets WHERE id = ${pgWalletId}
      `;
      expect(finalPgWallet.balance_cents).toBe("0");
      expect(finalPgWallet.version).toBe(31);

      // Invariante matemática no banco
      const [sumDebits] = await db.sql`
        SELECT SUM(amount_cents) as total FROM wallet_ledger_entries WHERE wallet_id = ${pgWalletId}
      `;
      expect(sumDebits.total).toBe("30000"); // 300.00 BRL
    });
  });
});
