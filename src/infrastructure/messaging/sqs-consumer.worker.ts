import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ProcessWagerTransactionInput } from "../../application/dtos/process-wager-transaction.dto";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "../../application/errors";
import type { InboxRepositoryPort } from "../../application/ports/inbox.repository.port";
import type { UnitOfWorkPort } from "../../application/ports/unit-of-work.port";
import type { ProcessWagerTransactionUseCase } from "../../application/use-cases/process-wager-transaction.use-case";
import { computeCanonicalPayloadHash } from "../../application/utils/canonical-json";
import { InboxMessage } from "../../domain/entities/inbox-message.entity";
import { WagerTransactionStatus } from "../../domain/enums";
import { DomainError } from "../../domain/errors/domain.error";
import {
  parseAndValidateWagerMessage,
  type WagerTransactionMessageDto,
} from "./dtos/wager-transaction-message.dto";
import { RequestContextService } from "../logging/request-context.service";
import { MetricsService } from "../metrics/metrics.service";

/**
 * Outcome status classification for message processing in SqsConsumerWorker.
 */
export type ProcessMessageStatus =
  | "PROCESSED"
  | "DUPLICATE"
  | "TERMINAL_BUSINESS_ERROR"
  | "TRANSIENT_ERROR"
  | "DLQ_FORWARDED"
  | "MALFORMED_DISCARDED";

/**
 * Processing result contract returned for each handled SQS message.
 */
export interface ProcessMessageResult {
  messageId?: string;
  status: ProcessMessageStatus;
  acked: boolean;
  error?: unknown;
}

/**
 * Configuration options for initializing SqsConsumerWorker.
 */
export interface SqsConsumerWorkerOptions {
  sqsClient?: SQSClient;
  endpointUrl?: string;
  region?: string;
  queueUrl?: string;
  dlqUrl?: string;
  consumerName?: string;
  maxRetries?: number;
  waitTimeSeconds?: number;
  maxNumberOfMessages?: number;
  visibilityTimeout?: number;
  unitOfWork?: UnitOfWorkPort;
}

/**
 * High-concurrency consumer worker for AWS SQS FIFO queues implementing the transactional Inbox pattern,
 * exponential backoff retries, and dead-letter queue routing.
 */
export class SqsConsumerWorker {
  private readonly logger = new Logger(SqsConsumerWorker.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly consumerName: string;
  private readonly maxRetries: number;
  private readonly waitTimeSeconds: number;
  private readonly maxNumberOfMessages: number;
  private readonly visibilityTimeout: number;
  private readonly unitOfWork: UnitOfWorkPort;

  private isRunning = false;
  private activeProcessingCount = 0;
  private readonly inFlightMessages = new Map<string, string>();

  constructor(
    private readonly useCase: ProcessWagerTransactionUseCase,
    private readonly inboxRepo: InboxRepositoryPort,
    options: SqsConsumerWorkerOptions = {},
  ) {
    const endpoint =
      options.endpointUrl ||
      process.env.AWS_ENDPOINT_URL ||
      "http://localhost:4566";
    const region = options.region || process.env.AWS_REGION || "us-east-1";

    this.sqsClient =
      options.sqsClient ||
      new SQSClient({
        endpoint,
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
        },
      });

    this.queueUrl =
      options.queueUrl ||
      process.env.SQS_QUEUE_URL ||
      `${endpoint}/000000000000/wager-transactions.fifo`;

    this.dlqUrl =
      options.dlqUrl ||
      process.env.SQS_DLQ_URL ||
      `${endpoint}/000000000000/wager-transactions-dlq.fifo`;

    this.consumerName =
      options.consumerName || "wager-transaction-consumer";
    this.maxRetries = options.maxRetries ?? 5;
    this.waitTimeSeconds = options.waitTimeSeconds ?? 10;
    this.maxNumberOfMessages = options.maxNumberOfMessages ?? 10;
    this.visibilityTimeout = options.visibilityTimeout ?? 30;

    this.unitOfWork = options.unitOfWork || {
      execute: async <T>(work: () => Promise<T>): Promise<T> => work(),
    };

    this.registerSignalHandlers();
  }

  /**
   * Processes a single message received from AWS SQS.
   * Guarantees idempotent execution, transactional boundary management, and safe message lifecycle.
   *
   * @param message - Raw AWS SQS message.
   * @returns Processing result indicating outcome status and whether message was acknowledged.
   */
  public async handleMessage(message: Message): Promise<ProcessMessageResult> {
    if (!message.ReceiptHandle) {
      this.logger.error("Mensagem recebida sem ReceiptHandle. Ignorando.");
      return { status: "TRANSIENT_ERROR", acked: false };
    }

    const receiptHandle = message.ReceiptHandle;
    const rawMessageId = message.MessageId || randomUUID();
    this.inFlightMessages.set(rawMessageId, receiptHandle);
    this.activeProcessingCount++;

    const contextStore = {
      messageId: rawMessageId,
      correlationId: null as string | null,
      transactionId: null as string | null,
      walletId: null as string | null,
      providerId: null as string | null,
    };

    return await RequestContextService.run(contextStore, async () => {
      try {
        let dto: WagerTransactionMessageDto;
        try {
          dto = await parseAndValidateWagerMessage(message.Body);
        } catch (err) {
          MetricsService.getInstance().incrementDlqMessages();
          this.logger.error(
            `Mensagem [${rawMessageId}] malformada descartada. Encaminhando para DLQ.`,
            err,
          );
          await this.sendToDlq(message);
          await this.deleteMessage(receiptHandle);
          return { status: "MALFORMED_DISCARDED", acked: true, error: err };
        }

        const messageId = dto.messageId;
        contextStore.messageId = messageId;
        contextStore.correlationId = dto.data?.idempotencyKey ?? null;
        contextStore.transactionId = dto.data?.externalTransactionId ?? null;
        contextStore.walletId = dto.data?.walletId ?? null;
        contextStore.providerId = dto.data?.providerId ?? null;

        const receiveCount = Number(
          message.Attributes?.ApproximateReceiveCount || 1,
        );

        const alreadyProcessed = await this.inboxRepo.exists(
          this.consumerName,
          messageId,
        );
        if (alreadyProcessed) {
          MetricsService.getInstance().incrementIdempotencyDuplicates();
          this.logger.log(
            `Mensagem [${messageId}] já processada pelo consumer [${this.consumerName}]. Executando ACK imediato.`,
          );
          await this.deleteMessage(receiptHandle);
          return { messageId, status: "DUPLICATE", acked: true };
        }

        if (receiveCount >= this.maxRetries) {
          MetricsService.getInstance().incrementDlqMessages();
          this.logger.error(
            `Mensagem [${messageId}] excedeu o limite máximo de tentativas (${receiveCount}/${this.maxRetries}). Encaminhando para DLQ.`,
          );
          await this.sendToDlq(message);
          await this.deleteMessage(receiptHandle);
          return { messageId, status: "DLQ_FORWARDED", acked: true };
        }

        const payloadHash = computeCanonicalPayloadHash(
          dto.data as unknown as Record<string, unknown>,
        );
        const inboxEntry = InboxMessage.receive({
          messageId,
          consumerName: this.consumerName,
          payloadHash,
        });

        const input: ProcessWagerTransactionInput = {
          idempotencyKey: dto.data.idempotencyKey,
          providerId: dto.data.providerId,
          externalTransactionId: dto.data.externalTransactionId,
          playerId: dto.data.playerId,
          walletId: dto.data.walletId,
          roundId: dto.data.roundId,
          gameId: dto.data.gameId,
          kind: dto.data.kind,
          money: {
            amount: dto.data.money.amount,
            currency: dto.data.money.currency,
          },
          referenceExternalTransactionId: dto.data.referenceExternalTransactionId,
          metadata: dto.data.metadata,
        };

        try {
          const result = await this.unitOfWork.execute(async () => {
            const res = await this.useCase.execute(input);
            inboxEntry.markProcessed();
            await this.inboxRepo.save(inboxEntry);
            return res;
          });

          if (
            result.status === WagerTransactionStatus.Rejected ||
            result.status === WagerTransactionStatus.Failed
          ) {
            MetricsService.getInstance().incrementTransactionsTotal(result.status);
            this.logger.log(
              `Transação [${result.transactionId}] rejeitada pelo domínio (${result.status}). ACK efetuado.`,
            );
            await this.deleteMessage(receiptHandle);
            return {
              messageId,
              status: "TERMINAL_BUSINESS_ERROR",
              acked: true,
            };
          }
        } catch (execError) {
          if (this.isBusinessError(execError)) {
            MetricsService.getInstance().incrementTransactionsTotal("REJECTED");
            this.logger.warn(
              `Erro de negócio terminal detectado para mensagem [${messageId}]: ${(execError as Error).message}. ACK efetuado.`,
            );
            await this.deleteMessage(receiptHandle);
            return {
              messageId,
              status: "TERMINAL_BUSINESS_ERROR",
              acked: true,
              error: execError,
            };
          }

          if (receiveCount >= this.maxRetries) {
            MetricsService.getInstance().incrementDlqMessages();
            this.logger.error(
              `Mensagem [${messageId}] falhou e atingiu o limite de tentativas (${receiveCount}/${this.maxRetries}). Encaminhando para DLQ.`,
            );
            await this.sendToDlq(message);
            await this.deleteMessage(receiptHandle);
            return {
              messageId,
              status: "DLQ_FORWARDED",
              acked: true,
              error: execError,
            };
          }

          MetricsService.getInstance().incrementMessagingRetries();
          this.logger.warn(
            `Falha transitória ao processar mensagem [${messageId}] (tentativa ${receiveCount}/${this.maxRetries}). NÃO efetuando ACK. Reagendando visibilidade.`,
            execError,
          );
          const backoffSeconds = this.calculateBackoff(receiveCount);
          await this.changeVisibility(receiptHandle, backoffSeconds);
          return {
            messageId,
            status: "TRANSIENT_ERROR",
            acked: false,
            error: execError,
          };
        }

        MetricsService.getInstance().incrementTransactionsTotal("PROCESSED");
        await this.deleteMessage(receiptHandle);
        this.logger.log(
          `Mensagem [${messageId}] processada e commitada com sucesso. ACK efetuado.`,
        );
        return { messageId, status: "PROCESSED", acked: true };
      } finally {
        this.inFlightMessages.delete(rawMessageId);
        this.activeProcessingCount--;
      }
    });
  }

  /**
   * Polls and processes the next batch of messages from the primary queue.
   *
   * @returns Array of processing results for all polled messages in the batch.
   */
  public async processNextBatch(): Promise<ProcessMessageResult[]> {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        WaitTimeSeconds: this.waitTimeSeconds,
        MaxNumberOfMessages: this.maxNumberOfMessages,
        VisibilityTimeout: this.visibilityTimeout,
        AttributeNames: ["All"],
      });

      const response = await this.sqsClient.send(command);
      const messages = response.Messages || [];

      if (messages.length === 0) {
        return [];
      }

      const results: ProcessMessageResult[] = [];
      for (const msg of messages) {
        if (!this.isRunning && this.activeProcessingCount === 0) {
          break;
        }
        const result = await this.handleMessage(msg);
        results.push(result);
      }

      return results;
    } catch (err) {
      this.logger.error("Erro durante ReceiveMessage no SQS:", err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return [];
    }
  }

  /**
   * Starts the continuous long-polling consumption loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log(
      `Iniciando SqsConsumerWorker [${this.consumerName}] na fila ${this.queueUrl}...`,
    );

    while (this.isRunning) {
      await this.processNextBatch();
    }
  }

  /**
   * Initiates graceful shutdown, draining in-flight messages and releasing broker visibility.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.logger.log("Sinal de interrupção recebido. Encerrando SqsConsumerWorker...");
    this.isRunning = false;

    const shutdownTimeout = 5000;
    const startTime = Date.now();
    while (this.activeProcessingCount > 0 && Date.now() - startTime < shutdownTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    for (const [messageId, receiptHandle] of this.inFlightMessages.entries()) {
      try {
        await this.changeVisibility(receiptHandle, 0);
        this.logger.log(
          `Visibilidade da mensagem [${messageId}] redefinida para 0 (liberada para reprocessamento).`,
        );
      } catch (err) {
        this.logger.warn(
          `Falha ao devolver visibilidade da mensagem [${messageId}]:`,
          err,
        );
      }
    }

    this.inFlightMessages.clear();
    this.logger.log("SqsConsumerWorker finalizado com sucesso.");
  }

  /**
   * Checks whether the consumer worker loop is actively running.
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Returns the count of messages currently undergoing asynchronous processing.
   */
  public getActiveProcessingCount(): number {
    return this.activeProcessingCount;
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }

  private async changeVisibility(
    receiptHandle: string,
    visibilityTimeoutSeconds: number,
  ): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeoutSeconds,
    });
    await this.sqsClient.send(command);
  }

  private async sendToDlq(message: Message): Promise<void> {
    const command = new SendMessageCommand({
      QueueUrl: this.dlqUrl,
      MessageBody: message.Body,
      MessageGroupId:
        message.Attributes?.MessageGroupId || "dlq-group",
      MessageDeduplicationId:
        message.Attributes?.MessageDeduplicationId ||
        message.MessageId ||
        randomUUID(),
    });
    await this.sqsClient.send(command);
  }

  private calculateBackoff(receiveCount: number): number {
    return Math.min(Math.pow(2, Math.max(1, receiveCount)) * 5, 300);
  }

  private isBusinessError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DomainError) return true;
    if (error instanceof IdempotencyConflictError) return true;
    if (error instanceof WalletNotFoundError) return true;
    if ((error as { isBusinessError?: boolean }).isBusinessError === true) {
      return true;
    }
    return false;
  }

  private registerSignalHandlers(): void {
    const shutdown = () => {
      this.stop().catch((err) =>
        this.logger.error("Erro durante shutdown do SQS worker:", err),
      );
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
