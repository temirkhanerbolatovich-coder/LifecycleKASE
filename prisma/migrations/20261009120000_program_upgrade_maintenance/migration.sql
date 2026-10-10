CREATE TABLE "program_upgrades" (
  "id" UUID NOT NULL PRIMARY KEY,
  "program_id" VARCHAR(44) NOT NULL,
  "network_genesis_hash" VARCHAR(44) NOT NULL,
  "buffer_address" VARCHAR(44) NOT NULL,
  "required_signer" VARCHAR(44) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'VERIFIED')),
  "reviewed_plan" JSONB NOT NULL,
  "protected_accounts" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMPTZ(6),
  CONSTRAINT "program_upgrade_verified_at_check" CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "program_upgrades_one_active_idx" ON "program_upgrades" ((1)) WHERE "status" = 'ACTIVE';
ALTER TABLE "blockchain_transactions" ADD COLUMN "program_upgrade_id" UUID REFERENCES "program_upgrades"("id") ON DELETE RESTRICT;
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "program_upgrade_attempt_check" CHECK (
  ("program_upgrade_id" IS NOT NULL) = ("operation_type" IN ('PROGRAM_EXTEND', 'PROGRAM_UPGRADE'))
  AND ("program_upgrade_id" IS NULL OR (
    "instrument_id" IS NULL AND "corporate_action_id" IS NULL AND "entitlement_id" IS NULL AND "investor_id" IS NULL
    AND "required_signer" IS NOT NULL AND "network_genesis_hash" IS NOT NULL
    AND "prepared_transaction_base64" IS NOT NULL AND "prepared_payload" IS NOT NULL
    AND "recent_blockhash" IS NOT NULL AND "last_valid_block_height" IS NOT NULL
  ))
);
CREATE UNIQUE INDEX "program_upgrade_one_active_attempt_idx" ON "blockchain_transactions" ("program_upgrade_id")
  WHERE "program_upgrade_id" IS NOT NULL AND "status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN_CONFIRMATION');

-- Serialize the maintenance boundary with business writes, including other API instances.
-- An interrupted upgrade keeps the durable lock until verified acceptance.
CREATE FUNCTION "guard_program_upgrade_maintenance"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1940912000);
  IF TG_TABLE_NAME = 'program_upgrades' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM program_upgrades WHERE status = 'ACTIVE') THEN
    IF TG_TABLE_NAME = 'blockchain_transactions' AND TG_OP <> 'DELETE' THEN
      IF NEW.program_upgrade_id IS NOT NULL AND NEW.operation_type IN ('PROGRAM_EXTEND', 'PROGRAM_UPGRADE') THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'PROGRAM_UPGRADE_MAINTENANCE: business writes are locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "program_upgrade_maintenance_boundary" BEFORE INSERT OR UPDATE ON "program_upgrades"
  FOR EACH ROW EXECUTE FUNCTION "guard_program_upgrade_maintenance"();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['investors', 'wallets', 'issuers', 'settlement_assets', 'instruments',
    'corporate_actions', 'snapshots', 'snapshot_investors', 'snapshot_wallets', 'snapshot_token_accounts',
    'entitlements', 'settlements', 'settlement_legs', 'action_receipts', 'execution_jobs', 'idempotency_records', 'blockchain_transactions']
  LOOP
    EXECUTE format('CREATE TRIGGER program_upgrade_business_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_program_upgrade_maintenance()', table_name);
  END LOOP;
END $$;
