ALTER TABLE "auth_challenges"
    ADD CONSTRAINT "auth_challenges_purpose_wallet_check"
    CHECK (
        ("purpose" = 'OPERATOR_LOGIN' AND "wallet_id" IS NULL)
        OR ("purpose" = 'INVESTOR_WALLET_VERIFICATION' AND "wallet_id" IS NOT NULL)
    );
