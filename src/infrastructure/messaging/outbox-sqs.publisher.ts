import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  MessagePublisher,
  PublishMetadata,
} from "../workers/outbox-relayer.worker";

/**
 * Configuration options for initializing OutboxSqsPublisher.
 */
export interface OutboxSqsPublisherOptions {
  sqsClient?: SQSClient;
  endpointUrl?: string;
  region?: string;
  queueUrl?: string;
}

/**
 * Concrete transactional outbox event publisher targeting AWS SQS FIFO queues via LocalStack or AWS.
 * Guarantees message ordering and broker-level deduplication via MessageGroupId and MessageDeduplicationId.
 */
export class OutboxSqsPublisher implements MessagePublisher {
  private readonly logger = new Logger(OutboxSqsPublisher.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;

  constructor(options: OutboxSqsPublisherOptions = {}) {
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
      process.env.OUTBOX_SQS_QUEUE_URL ||
      process.env.SQS_QUEUE_URL ||
      `${endpoint}/000000000000/wager-transactions.fifo`;
  }

  /**
   * Publishes an outbox event to AWS SQS FIFO queue with partition ordering and deduplication attributes.
   *
   * @param eventType - Event type name (e.g. WagerTransactionProcessed).
   * @param payload - Structured domain event payload to serialize.
   * @param metadata - Correlation metadata including aggregate ID and event ID.
   */
  public async publish(
    eventType: string,
    payload: Record<string, unknown>,
    metadata?: PublishMetadata,
  ): Promise<void> {
    const messageGroupId =
      metadata?.aggregateId ||
      (payload["aggregateId"] as string) ||
      (payload["walletId"] as string) ||
      "default-aggregate";

    const messageDeduplicationId =
      metadata?.eventId ||
      (payload["eventId"] as string) ||
      (payload["id"] as string) ||
      randomUUID();

    const messageBody =
      typeof payload === "string" ? payload : JSON.stringify(payload);

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: messageBody,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: messageDeduplicationId,
      MessageAttributes: {
        EventType: {
          DataType: "String",
          StringValue: eventType,
        },
      },
    });

    await this.sqsClient.send(command);

    this.logger.log(
      `Evento de integração [${eventType}] (dedupId: ${messageDeduplicationId}) publicado com sucesso na fila ${this.queueUrl}.`,
    );
  }
}
