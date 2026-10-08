-- Funding may mint simulated tokens only through an exact persisted wallet-signed attempt.
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "coupon_funding_prepared_wire_check" CHECK (
  "operation_type" <> 'COUPON_FUNDING' OR (
    "corporate_action_id" IS NOT NULL AND "instrument_id" IS NOT NULL
    AND "required_signer" IS NOT NULL AND "network_genesis_hash" IS NOT NULL
    AND "prepared_transaction_base64" IS NOT NULL AND "prepared_payload" IS NOT NULL
  )
);

-- One unresolved funding prompt per issuer prevents competing treasury deficit top-ups.
CREATE UNIQUE INDEX "blockchain_transactions_one_active_coupon_funding_idx"
  ON "blockchain_transactions" ("required_signer")
  WHERE "operation_type" = 'COUPON_FUNDING'
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');
