-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMINISTRATOR', 'INVESTOR', 'AUDITOR');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('DRAFT', 'DEPLOYING', 'ACTIVE', 'REDEEMED', 'FAILED');

-- CreateEnum
CREATE TYPE "CorporateActionType" AS ENUM ('COUPON_PAYMENT', 'BOND_REDEMPTION', 'EARLY_REDEMPTION');

-- CreateEnum
CREATE TYPE "CorporateActionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SNAPSHOT_CREATED', 'CALCULATED', 'READY_FOR_EXECUTION', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SNAPSHOT_MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('ON_CHAIN', 'SIMULATED_FIAT');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('PENDING_REGISTRATION', 'FINALIZED');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('CALCULATED', 'READY', 'PROCESSING', 'PAID', 'REDEEMED', 'NOT_ELIGIBLE_ZERO_ROUNDING', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'FINALIZED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "BlockchainTransactionStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'FINALIZED', 'UNKNOWN_CONFIRMATION', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED_FINAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "normalized_email" VARCHAR(320),
    "display_name" VARCHAR(200),
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "wallet_address" VARCHAR(44) NOT NULL,
    "nonce_hash" BYTEA NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "origin" VARCHAR(512) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investors" (
    "id" UUID NOT NULL,
    "external_reference" VARCHAR(100),
    "display_name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "address" VARCHAR(44) NOT NULL,
    "user_id" UUID,
    "investor_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuers" (
    "id" UUID NOT NULL,
    "legal_name" VARCHAR(250) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "issuers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "issuer_id" UUID NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "ticker" VARCHAR(20) NOT NULL,
    "asset_type" VARCHAR(20) NOT NULL DEFAULT 'BOND',
    "network" VARCHAR(30) NOT NULL DEFAULT 'SOLANA_DEVNET',
    "program_id" VARCHAR(44),
    "mint_address" VARCHAR(44),
    "authority_wallet" VARCHAR(44) NOT NULL,
    "face_value_minor" BIGINT NOT NULL,
    "currency" VARCHAR(20) NOT NULL DEFAULT 'USD_TEST',
    "settlement_decimals" INTEGER NOT NULL DEFAULT 6,
    "coupon_rate_bps" INTEGER NOT NULL,
    "payments_per_year" INTEGER NOT NULL,
    "issue_at" TIMESTAMPTZ(6) NOT NULL,
    "maturity_at" TIMESTAMPTZ(6) NOT NULL,
    "total_supply" BIGINT NOT NULL,
    "circulating_supply" BIGINT NOT NULL,
    "status" "InstrumentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_actions" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "type" "CorporateActionType" NOT NULL,
    "record_at" TIMESTAMPTZ(6) NOT NULL,
    "execute_at" TIMESTAMPTZ(6) NOT NULL,
    "redemption_percentage_bps" INTEGER,
    "redemption_price_minor" BIGINT,
    "status" "CorporateActionStatus" NOT NULL DEFAULT 'DRAFT',
    "eligible_holders" INTEGER NOT NULL DEFAULT 0,
    "total_entitlement_minor" BIGINT NOT NULL DEFAULT 0,
    "processed_entitlements" INTEGER NOT NULL DEFAULT 0,
    "failed_entitlements" INTEGER NOT NULL DEFAULT 0,
    "settlement_type" "SettlementType" NOT NULL DEFAULT 'ON_CHAIN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" UUID NOT NULL,
    "schema_version" VARCHAR(30) NOT NULL DEFAULT 'snapshot-v1',
    "instrument_id" UUID NOT NULL,
    "corporate_action_id" UUID NOT NULL,
    "record_at" TIMESTAMPTZ(6) NOT NULL,
    "network_genesis_hash" VARCHAR(64) NOT NULL,
    "solana_slot" BIGINT NOT NULL,
    "block_time" TIMESTAMPTZ(6) NOT NULL,
    "canonical_json" JSONB NOT NULL,
    "snapshot_hash" BYTEA NOT NULL,
    "holder_count" INTEGER NOT NULL,
    "total_balance" BIGINT NOT NULL,
    "mint_supply" BIGINT NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_holders" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "wallet_address" VARCHAR(44) NOT NULL,
    "balance" BIGINT NOT NULL,

    CONSTRAINT "snapshot_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_token_accounts" (
    "id" UUID NOT NULL,
    "snapshot_holder_id" UUID NOT NULL,
    "address" VARCHAR(44) NOT NULL,
    "balance" BIGINT NOT NULL,

    CONSTRAINT "snapshot_token_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "corporate_action_id" UUID NOT NULL,
    "snapshot_holder_id" UUID NOT NULL,
    "holder_wallet" VARCHAR(44) NOT NULL,
    "balance_at_record_date" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "tokens_to_redeem" BIGINT NOT NULL DEFAULT 0,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'CALCULATED',
    "execution_attempts" INTEGER NOT NULL DEFAULT 0,
    "onchain_pda" VARCHAR(44),
    "settlement_signature" VARCHAR(88),
    "burn_signature" VARCHAR(88),
    "last_error_code" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_transactions" (
    "id" UUID NOT NULL,
    "corporate_action_id" UUID,
    "entitlement_id" UUID,
    "operation_type" VARCHAR(80) NOT NULL,
    "signature" VARCHAR(88),
    "status" "BlockchainTransactionStatus" NOT NULL DEFAULT 'PREPARED',
    "recent_blockhash" VARCHAR(64),
    "last_valid_block_height" BIGINT,
    "submitted_at" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "blockchain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_jobs" (
    "id" UUID NOT NULL,
    "corporate_action_id" UUID NOT NULL,
    "entitlement_id" UUID,
    "job_type" VARCHAR(80) NOT NULL,
    "status" "ExecutionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "execution_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_wallet" VARCHAR(44),
    "event" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "metadata_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_nonce_hash_key" ON "auth_challenges"("nonce_hash");

-- CreateIndex
CREATE INDEX "auth_challenges_wallet_address_expires_at_idx" ON "auth_challenges"("wallet_address", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "investors_external_reference_key" ON "investors"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_investor_id_idx" ON "wallets"("investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_mint_address_key" ON "instruments"("mint_address");

-- CreateIndex
CREATE INDEX "instruments_status_maturity_at_idx" ON "instruments"("status", "maturity_at");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_issuer_id_ticker_key" ON "instruments"("issuer_id", "ticker");

-- CreateIndex
CREATE INDEX "corporate_actions_instrument_id_status_record_at_execute_at_idx" ON "corporate_actions"("instrument_id", "status", "record_at", "execute_at");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_corporate_action_id_key" ON "snapshots"("corporate_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_snapshot_hash_key" ON "snapshots"("snapshot_hash");

-- CreateIndex
CREATE INDEX "snapshots_instrument_id_solana_slot_idx" ON "snapshots"("instrument_id", "solana_slot");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_holders_snapshot_id_wallet_address_key" ON "snapshot_holders"("snapshot_id", "wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_token_accounts_snapshot_holder_id_address_key" ON "snapshot_token_accounts"("snapshot_holder_id", "address");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_onchain_pda_key" ON "entitlements"("onchain_pda");

-- CreateIndex
CREATE INDEX "entitlements_corporate_action_id_status_idx" ON "entitlements"("corporate_action_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_corporate_action_id_holder_wallet_key" ON "entitlements"("corporate_action_id", "holder_wallet");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_entitlement_id_key" ON "settlements"("entitlement_id");

-- CreateIndex
CREATE INDEX "settlements_status_created_at_idx" ON "settlements"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_transactions_signature_key" ON "blockchain_transactions"("signature");

-- CreateIndex
CREATE INDEX "blockchain_transactions_corporate_action_id_status_idx" ON "blockchain_transactions"("corporate_action_id", "status");

-- CreateIndex
CREATE INDEX "blockchain_transactions_entitlement_id_status_idx" ON "blockchain_transactions"("entitlement_id", "status");

-- CreateIndex
CREATE INDEX "execution_jobs_status_next_attempt_at_idx" ON "execution_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_idempotency_key_key" ON "idempotency_records"("scope", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "issuers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_corporate_action_id_fkey" FOREIGN KEY ("corporate_action_id") REFERENCES "corporate_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_holders" ADD CONSTRAINT "snapshot_holders_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_token_accounts" ADD CONSTRAINT "snapshot_token_accounts_snapshot_holder_id_fkey" FOREIGN KEY ("snapshot_holder_id") REFERENCES "snapshot_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_corporate_action_id_fkey" FOREIGN KEY ("corporate_action_id") REFERENCES "corporate_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_snapshot_holder_id_fkey" FOREIGN KEY ("snapshot_holder_id") REFERENCES "snapshot_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_corporate_action_id_fkey" FOREIGN KEY ("corporate_action_id") REFERENCES "corporate_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_corporate_action_id_fkey" FOREIGN KEY ("corporate_action_id") REFERENCES "corporate_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
