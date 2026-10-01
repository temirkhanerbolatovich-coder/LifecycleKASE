CREATE TYPE "AuthChallengePurpose" AS ENUM ('OPERATOR_LOGIN', 'INVESTOR_WALLET_VERIFICATION');

ALTER TABLE "auth_challenges"
    ADD COLUMN "wallet_id" UUID,
    ADD COLUMN "purpose" "AuthChallengePurpose" NOT NULL DEFAULT 'OPERATOR_LOGIN';

CREATE INDEX "auth_challenges_wallet_id_expires_at_idx"
    ON "auth_challenges"("wallet_id", "expires_at");

ALTER TABLE "auth_challenges"
    ADD CONSTRAINT "auth_challenges_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
