-- Local MVP wallets remain test-only; preserve verification/revocation invariants.
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_status_timeline_check";
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_status_timeline_check"
    CHECK (
        "network" IN ('SOLANA_DEVNET', 'SOLANA_LOCALNET')
        AND ("status" <> 'ACTIVE' OR "verified_at" IS NOT NULL)
        AND ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL)
    );
