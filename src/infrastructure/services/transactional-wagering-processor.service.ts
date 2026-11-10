import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { FailureCode } from "../../domain/enums/failure-code.enum";
import { LedgerDirection } from "../../domain/enums/ledger-direction.enum";
import { WagerTransactionKind } from "../../domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../domain/enums/wager-transaction-status.enum";

export interface TransactionalProcessInput {
  messageId: string;
  consumerName: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amountCents: bigint;
  currency: string;
}

export interface TransactionalProcessResult {
  transactionId: string;
  walletBalanceCents: bigint;
  status: WagerTransactionStatus;
  ledgerEntryId?: string;
  outboxMessageId?: string;
}

export class TransactionalWageringProcessorService {
  constructor(private readonly sql: SQL) {}

  public async processWithPessimisticLock(
    input: TransactionalProcessInput,
  ): Promise<TransactionalProcessResult> {
    return await this.sql.begin(async (tx) => {
      // 1. Lock pessimista na carteira: SELECT ... FOR UPDATE (LockMode.PESSIMISTIC_WRITE)
      const wallets = (await tx`
        SELECT id, player_id, currency, balance_cents, version
        FROM wallets
        WHERE id = ${input.walletId}
        FOR UPDATE
      `) as {
        id: string;
        player_id: string;
        currency: string;
        balance_cents: string;
        version: number;
      }[];

      if (wallets.length === 0) {
        throw new Error(`Wallet ${input.walletId} not found`);
      }

      const wallet = wallets[0]!;
      const currentBalanceCents = BigInt(wallet.balance_cents);
      const isDebit = input.kind === WagerTransactionKind.Bet;
      const isLoss = input.kind === WagerTransactionKind.Loss;

      const txId = randomUUID();

      // Registro no InboxMessage (participa da mesma transação atômica)
      await tx`
        INSERT INTO inbox_messages (
          message_id,
          consumer_name,
          payload_hash,
          received_at,
          processed_at
        ) VALUES (
          ${input.messageId},
          ${input.consumerName},
          ${input.payloadHash},
          NOW(),
          NOW()
        )
      `;

      // Verificação de saldo para BET
      if (isDebit && currentBalanceCents < input.amountCents) {
        await tx`
          INSERT INTO wager_transactions (
            id, provider_id, external_transaction_id, idempotency_key,
            payload_hash, wallet_id, player_id, round_id, game_id,
            kind, amount_cents, currency, status, failure_code, created_at, processed_at
          ) VALUES (
            ${txId}, ${input.providerId}, ${input.externalTransactionId}, ${input.idempotencyKey},
            ${input.payloadHash}, ${input.walletId}, ${input.playerId}, ${input.roundId}, ${input.gameId},
            ${input.kind}, ${input.amountCents.toString()}, ${input.currency},
            ${WagerTransactionStatus.Rejected}, ${FailureCode.InsufficientFunds}, NOW(), NOW()
          )
        `;

        return {
          transactionId: txId,
          walletBalanceCents: currentBalanceCents,
          status: WagerTransactionStatus.Rejected,
        };
      }

      let newBalanceCents = currentBalanceCents;
      let ledgerId: string | undefined;

      if (!isLoss) {
        newBalanceCents = isDebit
          ? currentBalanceCents - input.amountCents
          : currentBalanceCents + input.amountCents;

        // Atualização da Wallet
        await tx`
          UPDATE wallets
          SET 
            balance_cents = ${newBalanceCents.toString()},
            version = version + 1,
            updated_at = NOW()
          WHERE id = ${input.walletId}
        `;

        // Inserção atômica no WalletLedgerEntry
        ledgerId = randomUUID();
        const direction = isDebit ? LedgerDirection.Debit : LedgerDirection.Credit;

        await tx`
          INSERT INTO wallet_ledger_entries (
            id, wallet_id, transaction_id, direction, amount_cents,
            currency, balance_before_cents, balance_after_cents, created_at
          ) VALUES (
            ${ledgerId}, ${input.walletId}, ${txId}, ${direction}, ${input.amountCents.toString()},
            ${input.currency}, ${currentBalanceCents.toString()}, ${newBalanceCents.toString()}, NOW()
          )
        `;
      }

      // Inserção da WagerTransaction no estado PROCESSED
      await tx`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key,
          payload_hash, wallet_id, player_id, round_id, game_id,
          kind, amount_cents, currency, status, created_at, processed_at
        ) VALUES (
          ${txId}, ${input.providerId}, ${input.externalTransactionId}, ${input.idempotencyKey},
          ${input.payloadHash}, ${input.walletId}, ${input.playerId}, ${input.roundId}, ${input.gameId},
          ${input.kind}, ${input.amountCents.toString()}, ${input.currency},
          ${WagerTransactionStatus.Processed}, NOW(), NOW()
        )
      `;

      // Criação da OutboxMessage na mesma transação atômica
      const outboxId = randomUUID();
      const eventPayload = {
        transactionId: txId,
        walletId: input.walletId,
        playerId: input.playerId,
        kind: input.kind,
        amountCents: input.amountCents.toString(),
        currency: input.currency,
        newBalanceCents: newBalanceCents.toString(),
      };

      await tx`
        INSERT INTO outbox_messages (
          id, aggregate_id, event_type, payload, occurred_at
        ) VALUES (
          ${outboxId}, ${input.walletId}, 'WagerTransactionProcessed', ${JSON.stringify(eventPayload)}, NOW()
        )
      `;

      return {
        transactionId: txId,
        walletBalanceCents: newBalanceCents,
        status: WagerTransactionStatus.Processed,
        ledgerEntryId: ledgerId,
        outboxMessageId: outboxId,
      };
    });
  }
}
