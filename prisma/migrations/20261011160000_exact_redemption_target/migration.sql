-- Existing actions keep the original independent percentage-floor formula.
ALTER TABLE "corporate_actions"
  ADD COLUMN "redemption_allocation_policy" VARCHAR(64) NOT NULL DEFAULT 'integer-entitlements-v1',
  ADD COLUMN "redemption_target_tokens" BIGINT;

ALTER TABLE "corporate_actions" DROP CONSTRAINT "corporate_actions_type_parameters_check";
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_type_parameters_check" CHECK (
  (
    "type" IN ('COUPON_PAYMENT', 'BOND_REDEMPTION')
    AND "redemption_allocation_policy" = 'integer-entitlements-v1'
    AND "redemption_percentage_bps" IS NULL AND "redemption_price_minor" IS NULL
    AND "redemption_target_tokens" IS NULL
  ) OR (
    "type" = 'EARLY_REDEMPTION'
    AND "redemption_price_minor" IS NOT NULL AND "redemption_price_minor" > 0
    AND (
      ("redemption_allocation_policy" = 'integer-entitlements-v1'
       AND "redemption_percentage_bps" IS NOT NULL AND "redemption_percentage_bps" BETWEEN 1 AND 10000
       AND "redemption_target_tokens" IS NULL)
      OR ("redemption_allocation_policy" = 'exact-target-largest-remainder-v2'
          AND "redemption_percentage_bps" IS NULL
          AND "redemption_target_tokens" IS NOT NULL AND "redemption_target_tokens" > 0
          AND "redemption_target_tokens"::numeric * "redemption_price_minor"::numeric <= 9223372036854775807)
    )
  )
);

-- Policy and target identify a new action; revision may change receivers, never its obligation.
CREATE FUNCTION prevent_redemption_target_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.redemption_allocation_policy IS DISTINCT FROM OLD.redemption_allocation_policy
     OR NEW.redemption_target_tokens IS DISTINCT FROM OLD.redemption_target_tokens
     OR (OLD.redemption_allocation_policy = 'exact-target-largest-remainder-v2'
         AND ROW(NEW.type, NEW.instrument_id, NEW.record_at, NEW.execute_at, NEW.redemption_price_minor, NEW.redemption_percentage_bps)
             IS DISTINCT FROM ROW(OLD.type, OLD.instrument_id, OLD.record_at, OLD.execute_at, OLD.redemption_price_minor, OLD.redemption_percentage_bps)) THEN
    RAISE EXCEPTION 'redemption policy, target and exact action terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER corporate_action_redemption_target_immutable
  BEFORE UPDATE ON "corporate_actions" FOR EACH ROW EXECUTE FUNCTION prevent_redemption_target_change();
