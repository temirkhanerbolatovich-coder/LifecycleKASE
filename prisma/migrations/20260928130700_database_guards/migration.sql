-- Domain invariants that Prisma Schema Language cannot express.
ALTER TABLE "auth_challenges"
    ADD CONSTRAINT "auth_challenges_nonce_hash_length_check"
        CHECK (octet_length("nonce_hash") = 32),
    ADD CONSTRAINT "auth_challenges_expiry_check"
        CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "auth_challenges_used_at_check"
        CHECK ("used_at" IS NULL OR ("used_at" >= "created_at" AND "used_at" <= "expires_at"));

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_token_hash_length_check"
        CHECK (octet_length("token_hash") = 32),
    ADD CONSTRAINT "sessions_expiry_check"
        CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "sessions_revoked_at_check"
        CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_owner_check"
        CHECK ("user_id" IS NOT NULL OR "investor_id" IS NOT NULL);

ALTER TABLE "instruments"
    ADD CONSTRAINT "instruments_constants_check"
        CHECK (
            "asset_type" = 'BOND'
            AND "network" = 'SOLANA_DEVNET'
            AND "currency" = 'USD_TEST'
            AND "settlement_decimals" = 6
        ),
    ADD CONSTRAINT "instruments_financial_terms_check"
        CHECK (
            "face_value_minor" > 0
            AND "coupon_rate_bps" BETWEEN 0 AND 100000
            AND "payments_per_year" IN (1, 2, 4)
            AND "issue_at" < "maturity_at"
        ),
    ADD CONSTRAINT "instruments_supply_check"
        CHECK (
            "total_supply" > 0
            AND "circulating_supply" BETWEEN 0 AND "total_supply"
        ),
    ADD CONSTRAINT "instruments_version_check"
        CHECK ("version" >= 0);

ALTER TABLE "corporate_actions"
    ADD CONSTRAINT "corporate_actions_schedule_check"
        CHECK ("record_at" <= "execute_at"),
    ADD CONSTRAINT "corporate_actions_type_parameters_check"
        CHECK (
            (
                "type" IN ('COUPON_PAYMENT', 'BOND_REDEMPTION')
                AND "redemption_percentage_bps" IS NULL
                AND "redemption_price_minor" IS NULL
            )
            OR
            (
                "type" = 'EARLY_REDEMPTION'
                AND "redemption_percentage_bps" BETWEEN 1 AND 10000
                AND "redemption_price_minor" > 0
            )
        ),
    ADD CONSTRAINT "corporate_actions_counters_check"
        CHECK (
            "eligible_holders" >= 0
            AND "total_entitlement_minor" >= 0
            AND "processed_entitlements" >= 0
            AND "failed_entitlements" >= 0
            AND "processed_entitlements" + "failed_entitlements" <= "eligible_holders"
            AND "version" >= 0
        );

ALTER TABLE "snapshots"
    ADD CONSTRAINT "snapshots_schema_version_check"
        CHECK ("schema_version" = 'snapshot-v1'),
    ADD CONSTRAINT "snapshots_hash_length_check"
        CHECK (octet_length("snapshot_hash") = 32),
    ADD CONSTRAINT "snapshots_values_check"
        CHECK (
            "solana_slot" >= 0
            AND "holder_count" >= 0
            AND "total_balance" >= 0
            AND "mint_supply" >= 0
            AND "total_balance" = "mint_supply"
        ),
    ADD CONSTRAINT "snapshots_timeline_check"
        CHECK ("record_at" <= "block_time" AND "block_time" <= "created_at");

ALTER TABLE "snapshot_holders"
    ADD CONSTRAINT "snapshot_holders_balance_check"
        CHECK ("balance" > 0);

ALTER TABLE "snapshot_token_accounts"
    ADD CONSTRAINT "snapshot_token_accounts_balance_check"
        CHECK ("balance" > 0);

ALTER TABLE "entitlements"
    ADD CONSTRAINT "entitlements_values_check"
        CHECK (
            "balance_at_record_date" > 0
            AND "amount_minor" >= 0
            AND "tokens_to_redeem" BETWEEN 0 AND "balance_at_record_date"
            AND "execution_attempts" >= 0
            AND "version" >= 0
        );

ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_amount_check"
        CHECK ("amount_minor" > 0),
    ADD CONSTRAINT "settlements_finalized_at_check"
        CHECK ("finalized_at" IS NULL OR "finalized_at" >= "created_at");

ALTER TABLE "blockchain_transactions"
    ADD CONSTRAINT "blockchain_transactions_block_height_check"
        CHECK ("last_valid_block_height" IS NULL OR "last_valid_block_height" >= 0),
    ADD CONSTRAINT "blockchain_transactions_timeline_check"
        CHECK (
            ("submitted_at" IS NULL OR "submitted_at" >= "created_at")
            AND ("finalized_at" IS NULL OR ("submitted_at" IS NOT NULL AND "finalized_at" >= "submitted_at"))
        );

ALTER TABLE "execution_jobs"
    ADD CONSTRAINT "execution_jobs_attempt_count_check"
        CHECK ("attempt_count" >= 0);

ALTER TABLE "idempotency_records"
    ADD CONSTRAINT "idempotency_records_request_hash_length_check"
        CHECK (octet_length("request_hash") = 32),
    ADD CONSTRAINT "idempotency_records_response_status_check"
        CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599),
    ADD CONSTRAINT "idempotency_records_expiry_check"
        CHECK ("expires_at" > "created_at");

-- Once a snapshot is finalized, its commitment and payload are immutable.
CREATE FUNCTION "prevent_finalized_snapshot_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."status" = 'FINALIZED' THEN
        RAISE EXCEPTION 'finalized snapshot % is immutable', OLD."id"
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "snapshots_prevent_finalized_change"
BEFORE UPDATE OR DELETE ON "snapshots"
FOR EACH ROW
EXECUTE FUNCTION "prevent_finalized_snapshot_change"();

CREATE FUNCTION "prevent_finalized_snapshot_holder_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM "snapshots"
        WHERE "id" = OLD."snapshot_id" AND "status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'holders of finalized snapshot % are immutable', OLD."snapshot_id"
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM "snapshots"
        WHERE "id" = NEW."snapshot_id" AND "status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'holders cannot be added to finalized snapshot %', NEW."snapshot_id"
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "snapshot_holders_prevent_finalized_change"
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_holders"
FOR EACH ROW
EXECUTE FUNCTION "prevent_finalized_snapshot_holder_change"();

CREATE FUNCTION "prevent_finalized_token_account_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1
        FROM "snapshot_holders" AS holder
        JOIN "snapshots" AS snapshot ON snapshot."id" = holder."snapshot_id"
        WHERE holder."id" = OLD."snapshot_holder_id" AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'token accounts of finalized snapshot are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1
        FROM "snapshot_holders" AS holder
        JOIN "snapshots" AS snapshot ON snapshot."id" = holder."snapshot_id"
        WHERE holder."id" = NEW."snapshot_holder_id" AND snapshot."status" = 'FINALIZED'
    ) THEN
        RAISE EXCEPTION 'token accounts cannot be added to finalized snapshot'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "snapshot_token_accounts_prevent_finalized_change"
BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_token_accounts"
FOR EACH ROW
EXECUTE FUNCTION "prevent_finalized_token_account_change"();
