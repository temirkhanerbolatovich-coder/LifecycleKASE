ALTER TABLE "instruments"
  ADD COLUMN "token_policy" VARCHAR(40) NOT NULL DEFAULT 'LEGACY_UNRESTRICTED_V1',
  ADD CONSTRAINT "instruments_token_policy_check" CHECK (
    "token_policy" IN ('LEGACY_UNRESTRICTED_V1', 'CONTROLLED_FROZEN_V2')
    AND ("token_policy" <> 'CONTROLLED_FROZEN_V2' OR "network" = 'SOLANA_LOCALNET')
  );

CREATE FUNCTION prevent_instrument_token_policy_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_policy IS DISTINCT FROM OLD.token_policy THEN
    RAISE EXCEPTION 'instrument token policy is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER instruments_token_policy_immutable
  BEFORE UPDATE ON "instruments" FOR EACH ROW EXECUTE FUNCTION prevent_instrument_token_policy_change();

ALTER TABLE "snapshots" ADD COLUMN "capture_evidence" JSONB;
ALTER TABLE "corporate_actions" ADD COLUMN "controlled_capture_locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_capture_evidence_check" CHECK (
  "capture_evidence" IS NULL OR (
    jsonb_typeof("capture_evidence") = 'object'
    AND "capture_evidence"->>'schema' IS NOT DISTINCT FROM 'controlled-capture-v1'
  )
);
CREATE FUNCTION prevent_capture_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.capture_evidence IS NOT NULL AND NEW.capture_evidence IS DISTINCT FROM OLD.capture_evidence THEN
    RAISE EXCEPTION 'controlled capture evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER snapshots_capture_evidence_immutable
  BEFORE UPDATE ON "snapshots" FOR EACH ROW EXECUTE FUNCTION prevent_capture_evidence_change();
