-- This is a pre-MVP contract replacement. Stop before any destructive DDL when
-- domain records exist; a future live-data migration must map them explicitly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "instruments")
        OR EXISTS (SELECT 1 FROM "investors")
        OR EXISTS (SELECT 1 FROM "wallets")
        OR EXISTS (SELECT 1 FROM "corporate_actions")
        OR EXISTS (SELECT 1 FROM "snapshots")
        OR EXISTS (SELECT 1 FROM "entitlements")
        OR EXISTS (SELECT 1 FROM "settlements")
        OR EXISTS (SELECT 1 FROM "blockchain_transactions")
        OR EXISTS (SELECT 1 FROM "execution_jobs") THEN
        RAISE EXCEPTION 'investor registry migration requires an empty pre-MVP domain database'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

ALTER TABLE "instruments" DROP CONSTRAINT "instruments_constants_check";
ALTER TABLE "snapshots" DROP CONSTRAINT "snapshots_schema_version_check";
ALTER TABLE "snapshots" DROP CONSTRAINT "snapshots_values_check";

-- CreateEnum
CREATE TYPE "InvestorType" AS ENUM ('INDIVIDUAL', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'PENDING_REVIEW', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InvestorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CorporateActionSourceType" AS ENUM ('MANUAL', 'ISSUER_INSTRUCTION', 'EXCHANGE_EVENT', 'EXTERNAL_API', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SettlementLegType" AS ENUM ('CASH', 'ASSET');

-- CreateEnum
CREATE TYPE "SettlementLegStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "ActionReceiptStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- AlterEnum
BEGIN;
CREATE TYPE "CorporateActionStatus_new" AS ENUM ('DRAFT', 'SCHEDULED', 'SNAPSHOT_CREATED', 'CALCULATED', 'UNDER_REVIEW', 'RETURNED_FOR_REVISION', 'APPROVED', 'EXECUTING', 'PARTIALLY_SETTLED', 'SETTLED', 'RECONCILING', 'FINALIZED', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SNAPSHOT_MISSED', 'CANCELLED');
ALTER TABLE "corporate_actions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "corporate_actions" ALTER COLUMN "status" TYPE "CorporateActionStatus_new" USING ("status"::text::"CorporateActionStatus_new");
ALTER TYPE "CorporateActionStatus" RENAME TO "CorporateActionStatus_old";
ALTER TYPE "CorporateActionStatus_new" RENAME TO "CorporateActionStatus";
DROP TYPE "CorporateActionStatus_old";
ALTER TABLE "corporate_actions" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
ALTER TYPE "InstrumentStatus" ADD VALUE 'PAUSED';

-- AlterEnum
ALTER TYPE "SettlementStatus" ADD VALUE 'PROCESSING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'ISSUER_OPERATOR';
ALTER TYPE "UserRole" ADD VALUE 'COMPLIANCE_OFFICER';
ALTER TYPE "UserRole" ADD VALUE 'APPROVER';

-- DropForeignKey
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlements_snapshot_holder_id_fkey";

-- DropForeignKey
ALTER TABLE "snapshot_holders" DROP CONSTRAINT "snapshot_holders_snapshot_id_fkey";

-- DropForeignKey
ALTER TABLE "snapshot_token_accounts" DROP CONSTRAINT "snapshot_token_accounts_snapshot_holder_id_fkey";

-- DropIndex
DROP INDEX "entitlements_corporate_action_id_holder_wallet_key";

-- DropIndex
DROP INDEX "snapshot_token_accounts_snapshot_holder_id_address_key";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "blockchain_transaction_id" UUID,
ADD COLUMN     "corporate_action_id" UUID;

-- AlterTable
ALTER TABLE "blockchain_transactions" ADD COLUMN     "investor_id" UUID;

-- AlterTable
ALTER TABLE "corporate_actions" ADD COLUMN     "approved_at" TIMESTAMPTZ(6),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "created_by_id" UUID NOT NULL,
ADD COLUMN     "intent" VARCHAR(500) NOT NULL,
ADD COLUMN     "review_note" VARCHAR(1000),
ADD COLUMN     "source_document" VARCHAR(500),
ADD COLUMN     "source_reference" VARCHAR(250),
ADD COLUMN     "source_timestamp" TIMESTAMPTZ(6),
ADD COLUMN     "source_type" "CorporateActionSourceType" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "entitlements" DROP COLUMN "holder_wallet",
DROP COLUMN "snapshot_holder_id",
ADD COLUMN     "calculation_inputs" JSONB NOT NULL,
ADD COLUMN     "eligibility_reason" VARCHAR(500) NOT NULL,
ADD COLUMN     "formula_version" VARCHAR(50) NOT NULL,
ADD COLUMN     "investor_id" UUID NOT NULL,
ADD COLUMN     "settlement_wallet_address" VARCHAR(44) NOT NULL,
ADD COLUMN     "snapshot_investor_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "instruments" DROP COLUMN "authority_wallet",
ADD COLUMN     "compliance_authority" VARCHAR(44) NOT NULL,
ADD COLUMN     "corporate_action_authority" VARCHAR(44) NOT NULL,
ADD COLUMN     "freeze_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuer_approval_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuer_authority" VARCHAR(44) NOT NULL,
ADD COLUMN     "settlement_asset_id" UUID NOT NULL,
ADD COLUMN     "transfers_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whitelist_required" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "currency" SET DEFAULT 'KZT_TEST';

-- AlterTable
ALTER TABLE "investors" ADD COLUMN     "country_code" CHAR(2) NOT NULL,
ADD COLUMN     "eligibility_status" "EligibilityStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "status" "InvestorStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "type" "InvestorType" NOT NULL;

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "actual_amount_minor" BIGINT,
ADD COLUMN     "reconciled_at" TIMESTAMPTZ(6),
ADD COLUMN     "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "snapshot_token_accounts" DROP COLUMN "snapshot_holder_id",
ADD COLUMN     "snapshot_wallet_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "snapshots" DROP COLUMN "holder_count",
ADD COLUMN     "investor_count" INTEGER NOT NULL,
ADD COLUMN     "wallet_count" INTEGER NOT NULL,
ALTER COLUMN "schema_version" SET DEFAULT 'snapshot-v2';

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "network" VARCHAR(30) NOT NULL DEFAULT 'SOLANA_DEVNET',
ADD COLUMN     "revoked_at" TIMESTAMPTZ(6),
ADD COLUMN     "status" "WalletStatus" NOT NULL DEFAULT 'PENDING';

-- DropTable
DROP TABLE "snapshot_holders";

-- CreateTable
CREATE TABLE "settlement_assets" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "network" VARCHAR(30) NOT NULL DEFAULT 'SOLANA_DEVNET',
    "mint_address" VARCHAR(44),
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "disclaimer" VARCHAR(500) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settlement_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_investors" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "eligibility_status" "EligibilityStatus" NOT NULL,
    "balance" BIGINT NOT NULL,

    CONSTRAINT "snapshot_investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_wallets" (
    "id" UUID NOT NULL,
    "snapshot_investor_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "wallet_address" VARCHAR(44) NOT NULL,
    "wallet_status" "WalletStatus" NOT NULL,
    "balance" BIGINT NOT NULL,

    CONSTRAINT "snapshot_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_legs" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "type" "SettlementLegType" NOT NULL,
    "required" BOOLEAN NOT NULL,
    "status" "SettlementLegStatus" NOT NULL DEFAULT 'PENDING',
    "expected_amount_minor" BIGINT NOT NULL,
    "actual_amount_minor" BIGINT,
    "blockchain_transaction_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settlement_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_receipts" (
    "id" UUID NOT NULL,
    "corporate_action_id" UUID NOT NULL,
    "status" "ActionReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "payload_json" JSONB NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "onchain_pda" VARCHAR(44),
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_assets_code_key" ON "settlement_assets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_assets_mint_address_key" ON "settlement_assets"("mint_address");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_investors_snapshot_id_investor_id_key" ON "snapshot_investors"("snapshot_id", "investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_wallets_snapshot_investor_id_wallet_address_key" ON "snapshot_wallets"("snapshot_investor_id", "wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_wallets_snapshot_investor_id_wallet_id_key" ON "snapshot_wallets"("snapshot_investor_id", "wallet_id");

-- CreateIndex
CREATE INDEX "settlement_legs_status_created_at_idx" ON "settlement_legs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_legs_settlement_id_type_key" ON "settlement_legs"("settlement_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "action_receipts_corporate_action_id_key" ON "action_receipts"("corporate_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_receipts_payload_hash_key" ON "action_receipts"("payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "action_receipts_onchain_pda_key" ON "action_receipts"("onchain_pda");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_snapshot_investor_id_key" ON "entitlements"("snapshot_investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_corporate_action_id_investor_id_key" ON "entitlements"("corporate_action_id", "investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "execution_jobs_corporate_action_id_entitlement_id_job_type_key" ON "execution_jobs"("corporate_action_id", "entitlement_id", "job_type");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_token_accounts_snapshot_wallet_id_address_key" ON "snapshot_token_accounts"("snapshot_wallet_id", "address");

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_settlement_asset_id_fkey" FOREIGN KEY ("settlement_asset_id") REFERENCES "settlement_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_investors" ADD CONSTRAINT "snapshot_investors_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_investors" ADD CONSTRAINT "snapshot_investors_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_wallets" ADD CONSTRAINT "snapshot_wallets_snapshot_investor_id_fkey" FOREIGN KEY ("snapshot_investor_id") REFERENCES "snapshot_investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_wallets" ADD CONSTRAINT "snapshot_wallets_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_token_accounts" ADD CONSTRAINT "snapshot_token_accounts_snapshot_wallet_id_fkey" FOREIGN KEY ("snapshot_wallet_id") REFERENCES "snapshot_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_snapshot_investor_id_fkey" FOREIGN KEY ("snapshot_investor_id") REFERENCES "snapshot_investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_blockchain_transaction_id_fkey" FOREIGN KEY ("blockchain_transaction_id") REFERENCES "blockchain_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_corporate_action_id_fkey" FOREIGN KEY ("corporate_action_id") REFERENCES "corporate_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "instruments"
    ADD CONSTRAINT "instruments_constants_check"
        CHECK (
            "asset_type" = 'BOND'
            AND "network" = 'SOLANA_DEVNET'
            AND "currency" = 'KZT_TEST'
            AND "settlement_decimals" = 6
        ),
    ADD CONSTRAINT "instruments_transfer_controls_check"
        CHECK (NOT "freeze_enabled" AND NOT "whitelist_required" AND NOT "issuer_approval_required");

ALTER TABLE "settlement_assets"
    ADD CONSTRAINT "settlement_assets_demo_check"
        CHECK (
            "code" = 'KZT_TEST'
            AND "network" = 'SOLANA_DEVNET'
            AND "decimals" = 6
            AND "is_simulated"
            AND "disclaimer" = 'SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.'
        );

ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_status_timeline_check"
        CHECK (
            "network" = 'SOLANA_DEVNET'
            AND ("status" <> 'ACTIVE' OR "verified_at" IS NOT NULL)
            AND ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL)
        );

ALTER TABLE "snapshots"
    ADD CONSTRAINT "snapshots_schema_version_check"
        CHECK ("schema_version" = 'snapshot-v2'),
    ADD CONSTRAINT "snapshots_values_check"
        CHECK (
            "solana_slot" >= 0
            AND "investor_count" >= 0
            AND "wallet_count" >= "investor_count"
            AND "total_balance" >= 0
            AND "mint_supply" >= 0
            AND "total_balance" = "mint_supply"
        );

ALTER TABLE "snapshot_investors"
    ADD CONSTRAINT "snapshot_investors_balance_check" CHECK ("balance" > 0);
ALTER TABLE "snapshot_wallets"
    ADD CONSTRAINT "snapshot_wallets_balance_check" CHECK ("balance" > 0);
ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_reconciliation_check"
        CHECK (
            "actual_amount_minor" IS NULL OR "actual_amount_minor" >= 0
        );
ALTER TABLE "settlement_legs"
    ADD CONSTRAINT "settlement_legs_values_check"
        CHECK (
            "expected_amount_minor" >= 0
            AND ("actual_amount_minor" IS NULL OR "actual_amount_minor" >= 0)
            AND (
                ("required" AND "status" <> 'NOT_APPLICABLE')
                OR (NOT "required" AND "status" = 'NOT_APPLICABLE')
            )
        );
ALTER TABLE "action_receipts"
    ADD CONSTRAINT "action_receipts_hash_length_check"
        CHECK (octet_length("payload_hash") = 32);

CREATE FUNCTION "prevent_finalized_snapshot_investor_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM "snapshots"
        WHERE "id" = OLD."snapshot_id" AND "status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'investors of finalized snapshot are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM "snapshots"
        WHERE "id" = NEW."snapshot_id" AND "status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'investors cannot be added to finalized snapshot'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "snapshot_investors_prevent_finalized_change"
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_investors"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_snapshot_investor_change"();

CREATE FUNCTION "prevent_finalized_snapshot_wallet_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM "snapshot_investors" AS investor
        JOIN "snapshots" AS snapshot ON snapshot."id" = investor."snapshot_id"
        WHERE investor."id" = OLD."snapshot_investor_id"
          AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'wallets of finalized snapshot are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM "snapshot_investors" AS investor
        JOIN "snapshots" AS snapshot ON snapshot."id" = investor."snapshot_id"
        WHERE investor."id" = NEW."snapshot_investor_id"
          AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'wallets cannot be added to finalized snapshot'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "snapshot_wallets_prevent_finalized_change"
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_wallets"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_snapshot_wallet_change"();

CREATE OR REPLACE FUNCTION "prevent_finalized_token_account_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM "snapshot_wallets" AS wallet
        JOIN "snapshot_investors" AS investor ON investor."id" = wallet."snapshot_investor_id"
        JOIN "snapshots" AS snapshot ON snapshot."id" = investor."snapshot_id"
        WHERE wallet."id" = OLD."snapshot_wallet_id"
          AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'token accounts of finalized snapshot are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM "snapshot_wallets" AS wallet
        JOIN "snapshot_investors" AS investor ON investor."id" = wallet."snapshot_investor_id"
        JOIN "snapshots" AS snapshot ON snapshot."id" = investor."snapshot_id"
        WHERE wallet."id" = NEW."snapshot_wallet_id"
          AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'token accounts cannot be added to finalized snapshot'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
