ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_revocation_reason_required_check"
    CHECK ("status" <> 'REVOKED' OR "revocation_reason_code" IS NOT NULL);
