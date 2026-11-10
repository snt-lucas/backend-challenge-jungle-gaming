#!/usr/bin/env bash
set -euo pipefail

echo "Initializing LocalStack SQS FIFO queues..."

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

echo "LocalStack SQS FIFO queues initialized successfully!"
