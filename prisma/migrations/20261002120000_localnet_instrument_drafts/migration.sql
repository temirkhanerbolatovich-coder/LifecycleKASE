DO $$
BEGIN
    IF EXISTS (
        SELECT "legal_name" FROM "issuers" GROUP BY "legal_name" HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce unique issuer legal names while duplicates exist';
    END IF;
END;
$$;

CREATE UNIQUE INDEX "issuers_legal_name_key" ON "issuers"("legal_name");

ALTER TABLE "instruments" DROP CONSTRAINT "instruments_constants_check";
ALTER TABLE "instruments"
    ADD CONSTRAINT "instruments_constants_check"
        CHECK (
            "asset_type" = 'BOND'
            AND "network" IN ('SOLANA_DEVNET', 'SOLANA_LOCALNET')
            AND "currency" = 'KZT_TEST'
            AND "settlement_decimals" = 6
        );

ALTER TABLE "settlement_assets" DROP CONSTRAINT "settlement_assets_demo_check";
ALTER TABLE "settlement_assets"
    ADD CONSTRAINT "settlement_assets_demo_check"
        CHECK (
            "code" = 'KZT_TEST'
            AND "network" IN ('SOLANA_DEVNET', 'SOLANA_LOCALNET')
            AND "decimals" = 6
            AND "is_simulated"
            AND "disclaimer" = 'SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.'
        );
