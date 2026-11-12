import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InboxRepositoryPort } from "../../../src/application/ports/inbox.repository.port";
import type { UnitOfWorkPort } from "../../../src/application/ports/unit-of-work.port";
import type { ProcessWagerTransactionUseCase } from "../../../src/application/use-cases/process-wager-transaction.use-case";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../src/domain/enums";
import { InsufficientFundsError } from "../../../src/domain/errors/insufficient-funds.error";
import { SqsConsumerWorker } from "../../../src/infrastructure/messaging/sqs-consumer.worker";

describe("SqsConsumerWorker — Mensageria Assíncrona SQS com Padrão Inbox", () => {
  let worker: SqsConsumerWorker;
  let mockSqsClient: SQSClient;
  let mockUseCase: ProcessWagerTransactionUseCase;
  let mockInboxRepo: InboxRepositoryPort;
  let mockUnitOfWork: UnitOfWorkPort;
  let sentCommands: any[];

  const mainQueueUrl =
    "http://localhost:4566/000000000000/wager-transactions.fifo";
  const dlqUrl =
    "http://localhost:4566/000000000000/wager-transactions-dlq.fifo";

  const sampleMessagePayload = {
    messageId: "msg-123",
    type: "WagerTransactionRequested",
    occurredAt: "2026-07-29T15:00:00.000Z",
    data: {
      providerId: "provider-a",
      externalTransactionId: "transaction-123",
      idempotencyKey: "provider-a:transaction-123",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
    },
  };

  const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
    MessageId: "sqs-msg-123",
    ReceiptHandle: "receipt-handle-abc",
    Body: JSON.stringify(sampleMessagePayload),
    Attributes: {
      ApproximateReceiveCount: "1",
    },
    ...overrides,
  });

  beforeEach(() => {
    sentCommands = [];

    mockSqsClient = {
      send: mock(async (command: any) => {
        sentCommands.push(command);
        return {};
      }),
    } as unknown as SQSClient;

    mockUseCase = {
      execute: mock(),
    } as unknown as ProcessWagerTransactionUseCase;

    mockInboxRepo = {
      exists: mock(async () => false),
      save: mock(async () => {}),
    };

    mockUnitOfWork = {
      execute: mock(async (work) => work()),
    };

    worker = new SqsConsumerWorker(mockUseCase, mockInboxRepo, {
      sqsClient: mockSqsClient,
      queueUrl: mainQueueUrl,
      dlqUrl,
      consumerName: "wager-transaction-consumer",
      maxRetries: 5,
      unitOfWork: mockUnitOfWork,
    });
  });

  it("Teste 1: Processamento bem-sucedido de mensagem BET invocando ProcessWagerTransactionUseCase e executando DeleteMessageCommand", async () => {
    (mockUseCase.execute as ReturnType<typeof mock>).mockResolvedValue({
      transactionId: "tx-999",
      status: WagerTransactionStatus.Processed,
      balance: { amount: "975.00", currency: "BRL" },
      idempotentReplay: false,
    });

    const message = createMockMessage();
    const result = await worker.handleMessage(message);

    expect(result.status).toBe("PROCESSED");
    expect(result.acked).toBe(true);

    // 1. Verificou deduplicação no Inbox
    expect(mockInboxRepo.exists).toHaveBeenCalledWith(
      "wager-transaction-consumer",
      "msg-123",
    );

    // 2. Executou na mesma transação o Caso de Uso e a gravação do Inbox
    expect(mockUnitOfWork.execute).toHaveBeenCalledTimes(1);
    expect(mockUseCase.execute).toHaveBeenCalledWith({
      idempotencyKey: "provider-a:transaction-123",
      providerId: "provider-a",
      externalTransactionId: "transaction-123",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: undefined,
      metadata: undefined,
    });
    expect(mockInboxRepo.save).toHaveBeenCalledTimes(1);

    // 3. Confirmou ACK (DeleteMessageCommand) estritamente após o commit
    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
    expect(deleteCommand!.input.QueueUrl).toBe(mainQueueUrl);
    expect(deleteCommand!.input.ReceiptHandle).toBe("receipt-handle-abc");
  });

  it("Teste 2: Deduplicação de mensagem já existente no Inbox (deve fazer ack sem chamar o use case novamente)", async () => {
    (mockInboxRepo.exists as ReturnType<typeof mock>).mockResolvedValue(true);

    const message = createMockMessage();
    const result = await worker.handleMessage(message);

    expect(result.status).toBe("DUPLICATE");
    expect(result.acked).toBe(true);

    // Use case e unitOfWork NÃO devem ser acionados
    expect(mockUseCase.execute).toHaveBeenCalledTimes(0);
    expect(mockUnitOfWork.execute).toHaveBeenCalledTimes(0);
    expect(mockInboxRepo.save).toHaveBeenCalledTimes(0);

    // ACK imediato deve ser disparado
    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
    expect(deleteCommand!.input.ReceiptHandle).toBe("receipt-handle-abc");
  });

  it("Teste 3: Tratamento de erro de negócio (rejeição de aposta) confirmando que a mensagem sofre ack no broker", async () => {
    // Caso de uso retorna rejeição de negócio (ex: saldo insuficiente)
    (mockUseCase.execute as ReturnType<typeof mock>).mockResolvedValue({
      transactionId: "tx-rejected",
      status: WagerTransactionStatus.Rejected,
      balance: { amount: "10.00", currency: "BRL" },
      idempotentReplay: false,
      failureCode: FailureCode.InsufficientFunds,
    });

    const message = createMockMessage();
    const result = await worker.handleMessage(message);

    expect(result.status).toBe("TERMINAL_BUSINESS_ERROR");
    expect(result.acked).toBe(true);

    // Foi considerado erro terminal -> DeleteMessageCommand enviado
    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
    expect(deleteCommand!.input.ReceiptHandle).toBe("receipt-handle-abc");
  });

  it("Teste 3.1: Tratamento de erro de domínio lançado como exceção (DomainError) confirmando que sofre ack no broker", async () => {
    // Caso de uso lança uma exceção de domínio
    (mockUseCase.execute as ReturnType<typeof mock>).mockRejectedValue(
      new InsufficientFundsError("10.00", "25.00", "BRL"),
    );

    const message = createMockMessage();
    const result = await worker.handleMessage(message);

    expect(result.status).toBe("TERMINAL_BUSINESS_ERROR");
    expect(result.acked).toBe(true);

    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
  });

  it("Teste 4: Tratamento de erro transitório comprovando que o DeleteMessageCommand NÃO é disparado", async () => {
    // Falha transitória de infraestrutura (banco fora do ar / timeout)
    (mockUseCase.execute as ReturnType<typeof mock>).mockRejectedValue(
      new Error("Postgres connection timeout"),
    );

    const message = createMockMessage({
      Attributes: { ApproximateReceiveCount: "1" },
    });
    const result = await worker.handleMessage(message);

    expect(result.status).toBe("TRANSIENT_ERROR");
    expect(result.acked).toBe(false);

    // DeleteMessageCommand NÃO DEVE ser chamado
    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeUndefined();

    // ChangeMessageVisibilityCommand DEVE ser disparado para retry com backoff
    const visibilityCommand = sentCommands.find(
      (cmd) => cmd instanceof ChangeMessageVisibilityCommand,
    );
    expect(visibilityCommand).toBeDefined();
    expect(visibilityCommand!.input.ReceiptHandle).toBe("receipt-handle-abc");
    expect(visibilityCommand!.input.VisibilityTimeout).toBeGreaterThan(0);
  });

  it("Teste 5: Encaminhamento para DLQ após atingir limite de tentativas", async () => {
    // Mensagem com 5 tentativas (limite maxRetries = 5)
    const exhaustedMessage = createMockMessage({
      Attributes: {
        ApproximateReceiveCount: "5",
        MessageGroupId: "group-1",
      },
    });

    const result = await worker.handleMessage(exhaustedMessage);

    expect(result.status).toBe("DLQ_FORWARDED");
    expect(result.acked).toBe(true);

    // 1. Mensagem enviada para a fila DLQ
    const sendDlqCommand = sentCommands.find(
      (cmd) => cmd instanceof SendMessageCommand,
    );
    expect(sendDlqCommand).toBeDefined();
    expect(sendDlqCommand!.input.QueueUrl).toBe(dlqUrl);
    expect(sendDlqCommand!.input.MessageBody).toBe(exhaustedMessage.Body);

    // 2. Mensagem deletada da fila principal
    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
    expect(deleteCommand!.input.QueueUrl).toBe(mainQueueUrl);
    expect(deleteCommand!.input.ReceiptHandle).toBe("receipt-handle-abc");
  });

  it("Teste 6: Descarte de mensagem malformada com encaminhamento imediato para DLQ e ACK", async () => {
    const malformedMessage = createMockMessage({
      Body: JSON.stringify({ invalid: "data", missingFields: true }),
    });

    const result = await worker.handleMessage(malformedMessage);

    expect(result.status).toBe("MALFORMED_DISCARDED");
    expect(result.acked).toBe(true);

    const sendDlqCommand = sentCommands.find(
      (cmd) => cmd instanceof SendMessageCommand,
    );
    expect(sendDlqCommand).toBeDefined();

    const deleteCommand = sentCommands.find(
      (cmd) => cmd instanceof DeleteMessageCommand,
    );
    expect(deleteCommand).toBeDefined();
  });
});
