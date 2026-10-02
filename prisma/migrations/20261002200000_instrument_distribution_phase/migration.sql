ALTER TABLE "blockchain_transactions"
  ADD COLUMN "prepared_payload" JSONB;

CREATE UNIQUE INDEX "blockchain_transactions_one_active_distribution_idx"
  ON "blockchain_transactions" ("instrument_id", "operation_type")
  WHERE "operation_type" = 'INSTRUMENT_DISTRIBUTION'
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');
