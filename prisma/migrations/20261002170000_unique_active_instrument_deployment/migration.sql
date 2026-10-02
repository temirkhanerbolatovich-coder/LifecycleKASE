CREATE UNIQUE INDEX "blockchain_transactions_one_active_mint_setup_idx"
  ON "blockchain_transactions" ("instrument_id", "operation_type")
  WHERE "operation_type" = 'INSTRUMENT_MINT_SETUP'
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');
