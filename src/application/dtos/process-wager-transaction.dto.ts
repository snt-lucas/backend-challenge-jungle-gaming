import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import {
  type FailureCode,
  WagerTransactionKind,
  type WagerTransactionStatus,
} from "@domain/enums";

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash?: string;
  walletId: string;
  playerId?: string;
  wagererId?: string;
  roundId?: string;
  gameId?: string;
  kind: WagerTransactionKind;
  money?: {
    amount: string;
    currency: string;
  };
  amount?: string;
  currency?: string;
  referenceExternalTransactionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessWagerTransactionOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: {
    amount: string;
    currency: string;
  };
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

/**
 * DTO para submissão e processamento transacional de apostas e prêmios.
 * Mapeia os dados recebidos da API HTTP ou mensagens consumidas do SQS FIFO.
 */
export class ProcessWagerTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  wagererId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  /**
   * Representação monetária estrita.
   * Exige string decimal com exatamente 2 casas decimais (ex: "50.00", "100.50").
   * Proibido o uso de tipos numéricos binários (number/float).
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d{2}$/, {
    message:
      'amount deve ser uma string decimal com exatamente 2 casas decimais (ex: "10.00")',
  })
  amount!: string;

  /**
   * Código de moeda no formato padrão ISO-4217 de 3 letras maiúsculas.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, {
    message:
      'currency deve seguir o padrão ISO-4217 de 3 letras maiúsculas (ex: "BRL", "USD")',
  })
  currency!: string;

  /**
   * Tipo da operação financeira (BET, WIN, LOSS, REFUND, ROLLBACK, OPENING).
   */
  @IsEnum(WagerTransactionKind, {
    message:
      "kind deve ser um tipo válido de transação (BET, WIN, LOSS, REFUND, ROLLBACK, OPENING)",
  })
  @IsNotEmpty()
  kind!: WagerTransactionKind;

  /**
   * Identificador externo da transação referenciada.
   * Obrigatório para operações de reversão (REFUND e ROLLBACK) e opcional para WIN.
   */
  @IsString()
  @IsOptional()
  referenceExternalTransactionId?: string;

  /**
   * Metadados livres anexados à transação pelo provedor.
   */
  @IsOptional()
  metadata?: Record<string, unknown>;

  /**
   * Converte a instância para uma estrutura de objeto canônico (ordenada)
   * adequada para cálculo do payloadHash de idempotência sem poluição de metadados.
   */
  toCanonicalObject(): Record<string, unknown> {
    return {
      amount: this.amount,
      currency: this.currency,
      externalTransactionId: this.externalTransactionId,
      kind: this.kind,
      metadata: this.metadata ?? null,
      providerId: this.providerId,
      referenceExternalTransactionId:
        this.referenceExternalTransactionId ?? null,
      wagererId: this.wagererId,
      walletId: this.walletId,
    };
  }
}