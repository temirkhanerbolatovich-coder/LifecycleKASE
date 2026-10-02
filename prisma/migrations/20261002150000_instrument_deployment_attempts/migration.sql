ALTER TABLE "blockchain_transactions"
  ADD COLUMN "instrument_id" UUID,
  ADD COLUMN "required_signer" VARCHAR(44),
  ADD COLUMN "network_genesis_hash" VARCHAR(44),
  ADD COLUMN "prepared_transaction_base64" TEXT;

ALTER TABLE "blockchain_transactions"
  ADD CONSTRAINT "blockchain_transactions_instrument_id_fkey"
  FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "blockchain_transactions_instrument_id_status_idx"
  ON "blockchain_transactions"("instrument_id", "status");

ALTER TABLE "blockchain_transactions"
  ADD CONSTRAINT "blockchain_transactions_prepared_wire_check" CHECK (
    ("operation_type" = 'INSTRUMENT_MINT_SETUP' AND "instrument_id" IS NOT NULL
      AND "required_signer" IS NOT NULL AND "network_genesis_hash" IS NOT NULL
      AND "prepared_transaction_base64" IS NOT NULL)
    OR "operation_type" <> 'INSTRUMENT_MINT_SETUP'
  );
