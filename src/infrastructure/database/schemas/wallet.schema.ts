import { EntitySchema } from "@mikro-orm/core";

export interface WalletDbEntity {
  id: string;
  playerId: string;
  currency: string;
  balanceCents: bigint;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const WalletSchema = new EntitySchema<WalletDbEntity>({
  name: "Wallet",
  tableName: "wallets",
  properties: {
    id: { type: "string", primary: true, length: 36 },
    playerId: { type: "string", fieldName: "player_id", length: 36 },
    currency: { type: "string", length: 3 },
    balanceCents: { type: "bigint", fieldName: "balance_cents" },
    version: { type: "number", default: 1, version: true },
    createdAt: { type: "Date", fieldName: "created_at", defaultRaw: "NOW()" },
    updatedAt: { type: "Date", fieldName: "updated_at", defaultRaw: "NOW()" },
  },
  uniques: [
    {
      properties: ["playerId", "currency"],
      name: "uk_wallets_player_currency",
    },
  ],
  checks: [
    {
      expression: "balance_cents >= 0",
      name: "check_positive_balance",
    },
  ],
});
