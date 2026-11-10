-- 001_initial_schema.sql
-- Migração inicial de schema com constraints de integridade e auditoria contábil

CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(36) PRIMARY KEY,
    player_id VARCHAR(36) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_positive_balance CHECK (balance_cents >= 0),
    CONSTRAINT uk_wallets_player_currency UNIQUE (player_id, currency)
);

CREATE TABLE IF NOT EXISTS wager_transactions (
    id VARCHAR(36) PRIMARY KEY,
    provider_id VARCHAR(50) NOT NULL,
    external_transaction_id VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(150) NOT NULL UNIQUE,
    payload_hash VARCHAR(64) NOT NULL,
    wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
    player_id VARCHAR(36) NOT NULL,
    round_id VARCHAR(100) NOT NULL,
    game_id VARCHAR(100) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(30) NOT NULL,
    reference_external_transaction_id VARCHAR(100),
    reference_transaction_id VARCHAR(36),
    failure_code VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uk_wager_provider_external UNIQUE (provider_id, external_transaction_id)
);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
    transaction_id VARCHAR(36) NOT NULL REFERENCES wager_transactions(id),
    direction VARCHAR(10) NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_before_cents BIGINT NOT NULL,
    balance_after_cents BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_ledger_equation CHECK (
        (direction = 'DEBIT' AND balance_before_cents - amount_cents = balance_after_cents) OR
        (direction = 'CREDIT' AND balance_before_cents + amount_cents = balance_after_cents)
    )
);

CREATE TABLE IF NOT EXISTS inbox_messages (
    message_id VARCHAR(100) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (consumer_name, message_id)
);

CREATE TABLE IF NOT EXISTS outbox_messages (
    id VARCHAR(36) PRIMARY KEY,
    aggregate_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_skip_locked
    ON outbox_messages (occurred_at ASC)
    WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wager_tx_pending_reference
    ON wager_transactions (created_at ASC)
    WHERE status = 'PENDING_REFERENCE';
