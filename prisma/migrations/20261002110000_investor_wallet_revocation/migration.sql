ALTER TABLE "wallets"
    ADD COLUMN "revocation_reason_code" VARCHAR(50);

-- Preserve terminal records created before explicit revocation reasons existed.
UPDATE "wallets"
SET "revocation_reason_code" = 'LEGACY_STATUS_IMPORT'
WHERE "status" = 'REVOKED';

ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_revocation_reason_check"
    CHECK (
        ("status" = 'REVOKED'
            AND "revocation_reason_code" IN (
                'OWNER_REQUEST',
                'SECURITY_CONCERN',
                'WALLET_REPLACEMENT',
                'REGISTRY_CORRECTION',
                'LEGACY_STATUS_IMPORT'
            ))
        OR
        ("status" <> 'REVOKED' AND "revocation_reason_code" IS NULL)
    );
