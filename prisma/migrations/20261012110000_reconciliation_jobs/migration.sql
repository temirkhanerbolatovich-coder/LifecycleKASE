CREATE TYPE "ReconciliationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'COMPLETED', 'BLOCKED');

CREATE TABLE "reconciliation_jobs" (
  "id" UUID NOT NULL,
  "blockchain_transaction_id" UUID NOT NULL,
  "original_signature" VARCHAR(88) NOT NULL,
  "network_genesis_hash" VARCHAR(44) NOT NULL,
  "status" "ReconciliationJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "runner_id" VARCHAR(100),
  "last_error_code" VARCHAR(100),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "reconciliation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_jobs_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "reconciliation_jobs_lease_check" CHECK (
    ("status" = 'RUNNING' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "runner_id" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "runner_id" IS NULL)),
  CONSTRAINT "reconciliation_jobs_completed_check" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "reconciliation_jobs_signature_check" CHECK ("original_signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  CONSTRAINT "reconciliation_jobs_blockchain_transaction_id_fkey" FOREIGN KEY ("blockchain_transaction_id")
    REFERENCES "blockchain_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reconciliation_jobs_blockchain_transaction_id_key" ON "reconciliation_jobs"("blockchain_transaction_id");
CREATE INDEX "reconciliation_jobs_status_next_attempt_at_idx" ON "reconciliation_jobs"("status", "next_attempt_at");
CREATE INDEX "reconciliation_jobs_status_lease_expires_at_idx" ON "reconciliation_jobs"("status", "lease_expires_at");

CREATE FUNCTION preserve_reconciliation_job_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.blockchain_transaction_id IS DISTINCT FROM OLD.blockchain_transaction_id
    OR NEW.original_signature IS DISTINCT FROM OLD.original_signature
    OR NEW.network_genesis_hash IS DISTINCT FROM OLD.network_genesis_hash THEN
    RAISE EXCEPTION 'Reconciliation job identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reconciliation_job_identity_immutable
BEFORE UPDATE ON reconciliation_jobs FOR EACH ROW EXECUTE FUNCTION preserve_reconciliation_job_identity();
