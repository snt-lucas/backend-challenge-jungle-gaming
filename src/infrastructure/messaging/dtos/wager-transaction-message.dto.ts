import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
  validate,
} from "class-validator";
import { plainToInstance, Type } from "class-transformer";
import { WagerTransactionKind } from "@domain/enums";

/**
 * Error thrown when an incoming SQS message body fails structural JSON parsing or class-validator rules.
 */
export class MalformedMessageError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: string[],
  ) {
    super(message);
    this.name = "MalformedMessageError";
  }
}

/**
 * Validated monetary amount and currency payload nested in an SQS transaction message.
 */
export class WagerTransactionMoneyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d{2}$/, {
    message:
      'amount deve ser uma string decimal com exatamente 2 casas decimais (ex: "25.00")',
  })
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, {
    message:
      'currency deve seguir o padrão ISO-4217 de 3 letras maiúsculas (ex: "BRL")',
  })
  currency!: string;
}

/**
 * Business data payload contained in a wager transaction event message.
 */
export class WagerTransactionMessageDataDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind, {
    message:
      "kind deve ser um tipo válido de transação (BET, WIN, LOSS, REFUND, ROLLBACK, OPENING)",
  })
  @IsNotEmpty()
  kind!: WagerTransactionKind;

  @IsObject()
  @ValidateNested()
  @Type(() => WagerTransactionMoneyDto)
  money!: WagerTransactionMoneyDto;

  @IsString()
  @IsOptional()
  referenceExternalTransactionId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * Top-level SQS message payload wrapper defining envelope properties and data payload.
 */
export class WagerTransactionMessageDto {
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  occurredAt!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => WagerTransactionMessageDataDto)
  data!: WagerTransactionMessageDataDto;
}

/**
 * Parses and validates an incoming raw SQS message against WagerTransactionMessageDto constraints.
 *
 * @param rawBody - Raw JSON string or parsed object from SQS message body.
 * @returns Fully validated and transformed WagerTransactionMessageDto instance.
 * @throws MalformedMessageError if JSON syntax is invalid or schema validation fails.
 */
export async function parseAndValidateWagerMessage(
  rawBody: string | unknown,
): Promise<WagerTransactionMessageDto> {
  let parsed: unknown;
  if (typeof rawBody === "string") {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new MalformedMessageError(
        "Corpo da mensagem não é um JSON válido.",
      );
    }
  } else {
    parsed = rawBody;
  }

  if (!parsed || typeof parsed !== "object") {
    throw new MalformedMessageError(
      "Corpo da mensagem deve ser um objeto JSON.",
    );
  }

  const dto = plainToInstance(WagerTransactionMessageDto, parsed);
  const errors = await validate(dto);

  if (errors.length > 0) {
    const errorDetails = errors.flatMap((e) => {
      const constraints = e.constraints ? Object.values(e.constraints) : [];
      const childrenConstraints = e.children
        ? e.children.flatMap((c) =>
            c.constraints ? Object.values(c.constraints) : [],
          )
        : [];
      return [...constraints, ...childrenConstraints];
    });
    throw new MalformedMessageError(
      "Mensagem SQS malformada. Violações detectadas no esquema.",
      errorDetails,
    );
  }

  return dto;
}
