import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { FailureCode } from "../../domain/enums/failure-code.enum";
import { WagerTransactionStatus } from "../../domain/enums/wager-transaction-status.enum";

/**
 * Database representation of a pending reference transaction that has exceeded its TTL threshold.
 */
export interface ExpiredWagerTxRow {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  wallet_id: string;
  player_id: string;
  round_id: string;
  game_id: string;
  amount_cents: string;
  currency: string;
}

/**
 * Background worker sweeping orphaned transactions stranded in PENDING_REFERENCE status
 * past their time-to-live threshold, marking them REJECTED with ReferenceNotFound.
 */
export class PendingReferenceTtlWorker {
  constructor(private readonly sql: SQL) {}

  /**
   * Sweeps and rejects expired transactions whose parent reference was never received.
   * Atomically transitions status to REJECTED and emits a WagerTransactionRejected outbox event.
   *
   * @param ttlSeconds - Maximum permitted age in seconds before a pending transaction expires (defaults to 30).
   * @returns Array of expired transaction rows that were rejected during the run.
   */
  public async processExpired(ttlSeconds: number = 30): Promise<ExpiredWagerTxRow[]> {
    return await this.sql.begin(async (tx) => {
      const expiredTxs = (await tx`
        SELECT 
          id, 
          provider_id, 
          external_transaction_id, 
          wallet_id, 
          player_id, 
          round_id, 
          game_id, 
          amount_cents, 
          currency
        FROM wager_transactions
        WHERE status = ${WagerTransactionStatus.PendingReference}
          AND created_at <= NOW() - (${ttlSeconds} || ' seconds')::INTERVAL
        FOR UPDATE SKIP LOCKED
      `) as ExpiredWagerTxRow[];

      for (const row of expiredTxs) {
        await tx`
          UPDATE wager_transactions
          SET 
            status = ${WagerTransactionStatus.Rejected},
            failure_code = ${FailureCode.ReferenceNotFound},
            processed_at = NOW()
          WHERE id = ${row.id}
        `;

        const outboxId = randomUUID();
        const payload = {
          transactionId: row.id,
          providerId: row.provider_id,
          externalTransactionId: row.external_transaction_id,
          walletId: row.wallet_id,
          playerId: row.player_id,
          roundId: row.round_id,
          gameId: row.game_id,
          failureCode: FailureCode.ReferenceNotFound,
          status: WagerTransactionStatus.Rejected,
          occurredAt: new Date().toISOString(),
        };

        await tx`
          INSERT INTO outbox_messages (
            id,
            aggregate_id,
            event_type,
            payload,
            occurred_at
          ) VALUES (
            ${outboxId},
            ${row.id},
            'WagerTransactionRejected',
            ${JSON.stringify(payload)},
            NOW()
          )
        `;
      }

      return expiredTxs;
    });
  }
}
