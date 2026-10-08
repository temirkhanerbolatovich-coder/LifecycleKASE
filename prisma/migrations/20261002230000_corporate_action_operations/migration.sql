-- Exact prepared wire is mandatory for new action lifecycle operations.
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "action_operations_prepared_wire_check" CHECK (
  "operation_type" NOT IN ('ACTION_SCHEDULE', 'ACTION_CANCEL') OR (
    "corporate_action_id" IS NOT NULL AND "instrument_id" IS NOT NULL
    AND "required_signer" IS NOT NULL AND "network_genesis_hash" IS NOT NULL
    AND "prepared_transaction_base64" IS NOT NULL AND "prepared_payload" IS NOT NULL
  )
);

-- A signed/unknown attempt must never be replaced by another signature prompt.
CREATE UNIQUE INDEX "blockchain_transactions_one_active_action_operation_idx"
  ON "blockchain_transactions" ("corporate_action_id", "operation_type")
  WHERE "operation_type" IN ('ACTION_SCHEDULE', 'ACTION_CANCEL', 'REGISTER_SNAPSHOT')
    AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');
