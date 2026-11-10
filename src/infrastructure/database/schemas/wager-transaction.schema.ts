import { EntitySchema } from "@mikro-orm/core";
import { FailureCode } from "../../../domain/enums/failure-code.enum";
import { WagerTransactionKind } from "../../../domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../../domain/enums/wager-transaction-status.enum";

export interface WagerTransactionDbEntity {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amountCents: bigint;
  currency: string;
  status: WagerTransactionStatus;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  createdAt: Date;
  processedAt?: Date;
}

export const WagerTransactionSchema = new EntitySchema<WagerTransactionDbEntity>({
  name: "WagerTransaction",
  tableName: "wager_transactions",
  properties: {
    id: { type: "string", primary: true, length: 36 },
    providerId: { type: "string", fieldName: "provider_id", length: 50 },
    externalTransactionId: {
      type: "string",
      fieldName: "external_transaction_id",
      length: 100,
    },
    idempotencyKey: {
      type: "string",
      fieldName: "idempotency_key",
      length: 150,
    },
    payloadHash: { type: "string", fieldName: "payload_hash", length: 64 },
    walletId: { type: "string", fieldName: "wallet_id", length: 36 },
    playerId: { type: "string", fieldName: "player_id", length: 36 },
    roundId: { type: "string", fieldName: "round_id", length: 100 },
    gameId: { type: "string", fieldName: "game_id", length: 100 },
    kind: { type: "string", length: 20 },
    amountCents: { type: "bigint", fieldName: "amount_cents" },
    currency: { type: "string", length: 3 },
    status: { type: "string", length: 30 },
    referenceExternalTransactionId: {
      type: "string",
      fieldName: "reference_external_transaction_id",
      length: 100,
      nullable: true,
    },
    referenceTransactionId: {
      type: "string",
      fieldName: "reference_transaction_id",
      length: 36,
      nullable: true,
    },
    failureCode: {
      type: "string",
      fieldName: "failure_code",
      length: 50,
      nullable: true,
    },
    createdAt: { type: "Date", fieldName: "created_at", defaultRaw: "NOW()" },
    processedAt: { type: "Date", fieldName: "processed_at", nullable: true },
  },
  uniques: [
    {
      properties: ["providerId", "externalTransactionId"],
      name: "uk_wager_provider_external",
    },
    {
      properties: ["idempotencyKey"],
      name: "uk_wager_idempotency_key",
    },
  ],
  indexes: [
    {
      properties: ["createdAt"],
      name: "idx_wager_tx_pending_reference",
    },
  ],
});
