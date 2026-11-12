import { IsString } from "class-validator";

/**
 * Data transfer object validating payload for wallet creation.
 */
export class CreateWalletDTO {
  @IsString()
  readonly userId!: string;
}

/**
 * Data transfer object representing wallet retrieval response.
 */
export class GetWalletDTO {
  id!: string;
  balance!: string;
  currency!: string;
  createdAt!: Date;
}
