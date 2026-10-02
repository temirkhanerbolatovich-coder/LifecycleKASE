ALTER TABLE "blockchain_transactions"
  DROP CONSTRAINT "blockchain_transactions_prepared_wire_check";

ALTER TABLE "blockchain_transactions"
  ADD CONSTRAINT "blockchain_transactions_prepared_wire_check" CHECK (
    ("operation_type" IN (
      'INSTRUMENT_MINT_SETUP',
      'INSTRUMENT_DISTRIBUTION',
      'INSTRUMENT_INITIALIZE',
      'INSTRUMENT_ACTIVATE'
    ) AND "instrument_id" IS NOT NULL
      AND "required_signer" IS NOT NULL
      AND "network_genesis_hash" IS NOT NULL
      AND "prepared_transaction_base64" IS NOT NULL)
    OR "operation_type" NOT IN (
      'INSTRUMENT_MINT_SETUP',
      'INSTRUMENT_DISTRIBUTION',
      'INSTRUMENT_INITIALIZE',
      'INSTRUMENT_ACTIVATE'
    )
  );

CREATE UNIQUE INDEX "blockchain_transactions_one_active_initialize_idx"
  ON "blockchain_transactions" ("instrument_id", "operation_type")
  WHERE "operation_type" = 'INSTRUMENT_INITIALIZE'
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');

CREATE UNIQUE INDEX "blockchain_transactions_one_active_activate_idx"
  ON "blockchain_transactions" ("instrument_id", "operation_type")
  WHERE "operation_type" = 'INSTRUMENT_ACTIVATE'
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');
