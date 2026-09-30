ALTER TABLE "sessions"
ADD COLUMN "wallet_address" VARCHAR(44);

CREATE INDEX "sessions_wallet_address_expires_at_idx"
ON "sessions"("wallet_address", "expires_at");
