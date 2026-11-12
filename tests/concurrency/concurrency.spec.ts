import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { TestDatabaseHelper } from "../helpers/test-database.helper";
import { TransactionalWageringProcessorService } from "../../src/infrastructure/services/transactional-wagering-processor.service";
import { WagerTransactionKind } from "../../src/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/domain/enums/wager-transaction-status.enum";
import { Money } from "../../src/domain/value-objects/money.vo";

describe("Concorrência Extrema e Paralelismo Real (PostgreSQL 16 & SELECT ... FOR UPDATE)", () => {
  const db = TestDatabaseHelper.getInstance();
  let isDbAvailable = false;
  let service: TransactionalWageringProcessorService;

  beforeAll(async () => {
    isDbAvailable = await db.checkAvailability();
    if (isDbAvailable) {
      await db.runMigrations();
      service = new TransactionalWageringProcessorService(db.sql);
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await db.cleanDatabase();
    }
  });

  describe("1. Cenário Obrigatório do Desafio (Seção 8 do README)", () => {
    it("deve processar exatamente 1 aposta de 80.00 BRL e rejeitar a 2ª com saldo final 20.00 BRL e 1 débito no ledger", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 10000, 1)
      `;

      // Duas apostas simultâneas de 80.00 BRL disputando a mesma carteira
      const bet1 = service.processWithPessimisticLock({
        messageId: "msg-race-01",
        consumerName: "race-consumer",
        walletId,
        playerId,
        providerId: "provider-race",
        externalTransactionId: "ext-race-01",
        idempotencyKey: "prov:ext-race-01",
        payloadHash: "hash-01",
        roundId: "round-race-1",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        amountCents: 8000n, // 80.00 BRL
        currency: "BRL",
      });

      const bet2 = service.processWithPessimisticLock({
        messageId: "msg-race-02",
        consumerName: "race-consumer",
        walletId,
        playerId,
        providerId: "provider-race",
        externalTransactionId: "ext-race-02",
        idempotencyKey: "prov:ext-race-02",
        payloadHash: "hash-02",
        roundId: "round-race-2",
        gameId: "roulette",
        kind: WagerTransactionKind.Bet,
        amountCents: 8000n, // 80.00 BRL
        currency: "BRL",
      });

      const [res1, res2] = await Promise.all([bet1, bet2]);
      const results = [res1, res2];

      const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
      const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

      // Exatamente 1 aposta PROCESSED e 1 REJECTED por InsufficientFunds
      expect(processed.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Saldo final deve ser exatamente 20.00 BRL (2000 cents)
      const [walletRow] = await db.sql`
        SELECT balance_cents, version FROM wallets WHERE id = ${walletId}
      `;
      expect(walletRow.balance_cents).toBe("2000");
      expect(walletRow.version).toBe(2);

      // Exatamente 1 lançamento de débito no ledger
      const [ledgerCount] = await db.sql`
        SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(ledgerCount.count).toBe("1");

      const [ledgerRow] = await db.sql`
        SELECT direction, amount_cents, balance_before_cents, balance_after_cents
        FROM wallet_ledger_entries
        WHERE wallet_id = ${walletId}
      `;
      expect(ledgerRow.direction).toBe("DEBIT");
      expect(ledgerRow.amount_cents).toBe("8000");
      expect(ledgerRow.balance_before_cents).toBe("10000");
      expect(ledgerRow.balance_after_cents).toBe("2000");

      // Invariante Contábil Obrigatória
      const invariant = await db.assertLedgerInvariant(walletId, initialBalance);
      expect(invariant.walletBalance.amount).toBe("20.00");
      expect(invariant.reconstructedBalance.amount).toBe("20.00");
    });
  });

  describe("2. Contenção Massiva de 50 Apostas Idênticas em Paralelo (Idempotência Estrita)", () => {
    it("deve processar apenas 1 débito, retornar idempotentReplay para as outras 49 e não duplicar ledger", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 10000, 1)
      `;

      const sharedIdempotencyKey = "shared-idemp-key-50-concurrent";
      const sharedExternalTxId = "ext-tx-concurrent-50";

      // 50 requisições simultâneas com a mesma chave e payload idêntico
      const requests = Array.from({ length: 50 }, (_, i) => {
        return service.processWithPessimisticLock({
          messageId: `msg-idemp-${i}`,
          consumerName: "wager-consumer",
          walletId,
          playerId,
          providerId: "provider-x",
          externalTransactionId: sharedExternalTxId,
          idempotencyKey: sharedIdempotencyKey,
          payloadHash: "hash-same-payload",
          roundId: "round-same",
          gameId: "slots",
          kind: WagerTransactionKind.Bet,
          amountCents: 1000n, // 10.00 BRL
          currency: "BRL",
        });
      });

      const results = await Promise.all(requests);

      const firstProcessed = results.filter((r) => r.status === WagerTransactionStatus.Processed && !r.idempotentReplay);
      const replays = results.filter((r) => r.idempotentReplay === true);

      expect(firstProcessed.length).toBe(1);
      expect(replays.length).toBe(49);

      // Saldo final deve ser exatamente 90.00 BRL
      const [walletRow] = await db.sql`
        SELECT balance_cents, version FROM wallets WHERE id = ${walletId}
      `;
      expect(walletRow.balance_cents).toBe("9000");
      expect(walletRow.version).toBe(2);

      // Exatamente 1 lançamento no ledger
      const [ledgerCount] = await db.sql`
        SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(ledgerCount.count).toBe("1");

      // Invariante Contábil Obrigatória
      const invariant = await db.assertLedgerInvariant(walletId, initialBalance);
      expect(invariant.walletBalance.amount).toBe("90.00");
    });
  });

  describe("3. Disputa Concorrente de Múltiplas Instâncias (Hot Wallet de 300.00 BRL)", () => {
    it("deve processar 30 apostas de 10.00 BRL, rejeitar 70 por saldo insuficiente sem deadlocks e zerar saldo", async () => {
      if (!isDbAvailable) {
        console.warn(
          "⚠️ [PULADO]: Contêiner Docker PostgreSQL não ativo em localhost:5432. Inicie via: docker compose up -d",
        );
        return;
      }

      const walletId = randomUUID();
      const playerId = randomUUID();
      const initialBalance = Money.from({ amount: "300.00", currency: "BRL" });

      await db.sql`
        INSERT INTO wallets (id, player_id, currency, balance_cents, version)
        VALUES (${walletId}, ${playerId}, 'BRL', 30000, 1)
      `;

      const totalRequests = 100;
      const betCents = 1000n; // 10.00 BRL

      const concurrentRequests = Array.from({ length: totalRequests }, (_, i) => {
        const extId = `hot-ext-tx-${i}`;
        return service.processWithPessimisticLock({
          messageId: `msg-hot-${i}`,
          consumerName: `consumer-instance-${i % 3}`, // Simula 3 instâncias concorrentes
          walletId,
          playerId,
          providerId: "pragmatic",
          externalTransactionId: extId,
          idempotencyKey: `pragmatic:${extId}`,
          payloadHash: `hash-hot-${i}`,
          roundId: `round-${i}`,
          gameId: "spaceman",
          kind: WagerTransactionKind.Bet,
          amountCents: betCents,
          currency: "BRL",
        });
      });

      const results = await Promise.all(concurrentRequests);

      const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
      const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

      expect(processed.length).toBe(30);
      expect(rejected.length).toBe(70);

      // Saldo final deve ser exatamente 0.00 BRL
      const [walletRow] = await db.sql`
        SELECT balance_cents, version FROM wallets WHERE id = ${walletId}
      `;
      expect(walletRow.balance_cents).toBe("0");
      expect(walletRow.version).toBe(31); // 1 inicial + 30 atualizações

      // Exatamente 30 lançamentos de débito no ledger
      const [ledgerCount] = await db.sql`
        SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(ledgerCount.count).toBe("30");

      const [sumDebits] = await db.sql`
        SELECT SUM(amount_cents) as total FROM wallet_ledger_entries WHERE wallet_id = ${walletId}
      `;
      expect(sumDebits.total).toBe("30000"); // 300.00 BRL

      // Invariante Contábil Obrigatória
      const invariant = await db.assertLedgerInvariant(walletId, initialBalance);
      expect(invariant.walletBalance.amount).toBe("0.00");
      expect(invariant.reconstructedBalance.amount).toBe("0.00");
    });
  });
});
