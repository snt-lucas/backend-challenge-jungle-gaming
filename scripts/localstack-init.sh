#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for LocalStack to be ready..."

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

echo "LocalStack SQS FIFO queues initialized successfully:"
awslocal sqs list-queues
