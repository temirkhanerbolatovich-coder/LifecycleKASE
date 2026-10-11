ALTER TABLE "investors" ADD COLUMN "registry_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "wallets" ADD COLUMN "registry_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "investors" ADD CONSTRAINT "investors_registry_version_positive" CHECK ("registry_version" > 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_registry_version_positive" CHECK ("registry_version" > 0);

-- Version every effective registry change, including controlled maintenance outside the HTTP API.
-- This detects ACTIVE -> BLOCKED -> ACTIVE even though the final status matches an old form.
CREATE FUNCTION advance_investor_registry_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.display_name, NEW.external_reference, NEW.type, NEW.country_code,
         NEW.kyc_status, NEW.eligibility_status, NEW.eligibility_reason_code,
         NEW.eligibility_reviewed_at, NEW.status)
     IS DISTINCT FROM
     ROW(OLD.display_name, OLD.external_reference, OLD.type, OLD.country_code,
         OLD.kyc_status, OLD.eligibility_status, OLD.eligibility_reason_code,
         OLD.eligibility_reviewed_at, OLD.status) THEN
    NEW.registry_version := OLD.registry_version + 1;
  ELSIF NEW.registry_version IS DISTINCT FROM OLD.registry_version THEN
    RAISE EXCEPTION 'Registry version cannot change without a registry change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION advance_wallet_registry_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.address, NEW.user_id, NEW.investor_id, NEW.network, NEW.status,
         NEW.verified_at, NEW.revoked_at, NEW.revocation_reason_code)
     IS DISTINCT FROM
     ROW(OLD.address, OLD.user_id, OLD.investor_id, OLD.network, OLD.status,
         OLD.verified_at, OLD.revoked_at, OLD.revocation_reason_code) THEN
    NEW.registry_version := OLD.registry_version + 1;
  ELSIF NEW.registry_version IS DISTINCT FROM OLD.registry_version THEN
    RAISE EXCEPTION 'Registry version cannot change without a registry change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER investors_registry_version_guard BEFORE UPDATE ON "investors"
  FOR EACH ROW EXECUTE FUNCTION advance_investor_registry_version();
CREATE TRIGGER wallets_registry_version_guard BEFORE UPDATE ON "wallets"
  FOR EACH ROW EXECUTE FUNCTION advance_wallet_registry_version();
