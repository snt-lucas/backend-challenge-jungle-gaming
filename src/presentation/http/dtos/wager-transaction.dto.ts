import { IsString, MinLength, MaxLength } from "class-validator";
import { Transform, type TransformFnParams } from "class-transformer";

/**
 * Data transfer object validating payload for wager transaction creation.
 */
export class CreateWagerTransactionDTO {
  @IsString()
  @MinLength(3)
  @MaxLength(10)
  readonly idempotencyKey!: string;

  @IsString()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === "string" && value.includes(".") && value.split(".")[1]?.length === 2
      ? value
      : value,
  )
  readonly amount!: string;

  @IsString()
  readonly wagererId!: string;
}