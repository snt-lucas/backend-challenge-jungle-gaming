import { EntitySchema } from "@mikro-orm/core";
import { LedgerDirection } from "../../../domain/enums/ledger-direction.enum";

export interface WalletLedgerEntryDbEntity {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amountCents: bigint;
  currency: string;
  balanceBeforeCents: bigint;
  balanceAfterCents: bigint;
  createdAt: Date;
}

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryDbEntity>({
  name: "WalletLedgerEntry",
  tableName: "wallet_ledger_entries",
  properties: {
    id: { type: "string", primary: true, length: 36 },
    walletId: { type: "string", fieldName: "wallet_id", length: 36 },
    transactionId: { type: "string", fieldName: "transaction_id", length: 36 },
    direction: { type: "string", length: 10 },
    amountCents: { type: "bigint", fieldName: "amount_cents" },
    currency: { type: "string", length: 3 },
    balanceBeforeCents: {
      type: "bigint",
      fieldName: "balance_before_cents",
    },
    balanceAfterCents: {
      type: "bigint",
      fieldName: "balance_after_cents",
    },
    createdAt: { type: "Date", fieldName: "created_at", defaultRaw: "NOW()" },
  },
  checks: [
    {
      expression:
        "((direction = 'DEBIT' AND balance_before_cents - amount_cents = balance_after_cents) OR (direction = 'CREDIT' AND balance_before_cents + amount_cents = balance_after_cents))",
      name: "check_ledger_equation",
    },
  ],
});
