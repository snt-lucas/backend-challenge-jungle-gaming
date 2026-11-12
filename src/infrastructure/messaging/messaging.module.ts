import { Global, Module } from "@nestjs/common";
import { SQSClient } from "@aws-sdk/client-sqs";
import { OutboxSqsPublisher } from "./outbox-sqs.publisher";

@Global()
@Module({
  providers: [
    {
      provide: "SQS_CLIENT",
      useFactory: () => {
        return new SQSClient({
          endpoint:
            process.env.AWS_ENDPOINT_URL ||
            process.env.LOCALSTACK_ENDPOINT ||
            "http://localhost:4566",
          region: process.env.AWS_REGION || "us-east-1",
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
          },
        });
      },
    },
    {
      provide: SQSClient,
      useExisting: "SQS_CLIENT",
    },
    {
      provide: OutboxSqsPublisher,
      useFactory: (sqsClient: SQSClient) => {
        return new OutboxSqsPublisher({ sqsClient });
      },
      inject: ["SQS_CLIENT"],
    },
  ],
  exports: ["SQS_CLIENT", SQSClient, OutboxSqsPublisher],
})
export class MessagingModule {}
