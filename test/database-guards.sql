BEGIN;

INSERT INTO "issuers" (
    "id", "legal_name", "created_at", "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'LifecycleKASE Test Issuer',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        INSERT INTO "wallets" ("id", "address", "created_at")
        VALUES (
            '00000000-0000-4000-8000-000000000010',
            '11111111111111111111111111111111',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'wallet owner constraint did not reject an unowned wallet';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO "instruments" (
            "id", "issuer_id", "name", "ticker", "authority_wallet",
            "face_value_minor", "coupon_rate_bps", "payments_per_year",
            "issue_at", "maturity_at", "total_supply", "circulating_supply",
            "updated_at"
        ) VALUES (
            '00000000-0000-4000-8000-000000000011',
            '00000000-0000-4000-8000-000000000001',
            'Invalid Bond',
            'INVALID',
            '11111111111111111111111111111111',
            -1,
            500,
            1,
            '2026-01-01T00:00:00Z',
            '2027-01-01T00:00:00Z',
            35,
            35,
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'financial terms constraint did not reject a negative face value';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO "instruments" (
    "id", "issuer_id", "name", "ticker", "authority_wallet",
    "face_value_minor", "coupon_rate_bps", "payments_per_year",
    "issue_at", "maturity_at", "total_supply", "circulating_supply",
    "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'Canonical Demo Bond',
    'KASE35',
    '11111111111111111111111111111111',
    1000,
    500,
    1,
    '2026-01-01T00:00:00Z',
    '2027-01-01T00:00:00Z',
    35,
    35,
    CURRENT_TIMESTAMP
);

INSERT INTO "corporate_actions" (
    "id", "instrument_id", "type", "record_at", "execute_at",
    "eligible_holders", "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000002',
    'COUPON_PAYMENT',
    '2026-09-28T10:00:00Z',
    '2026-09-28T11:00:00Z',
    1,
    CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        INSERT INTO "snapshots" (
            "id", "instrument_id", "corporate_action_id", "record_at",
            "network_genesis_hash", "solana_slot", "block_time",
            "canonical_json", "snapshot_hash", "holder_count",
            "total_balance", "mint_supply", "created_at"
        ) VALUES (
            '00000000-0000-4000-8000-000000000014',
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000003',
            '2026-09-28T10:00:00Z',
            '11111111111111111111111111111111',
            123456,
            '2026-09-28T10:00:02Z',
            '{}'::jsonb,
            decode(repeat('00', 32), 'hex'),
            1,
            34,
            35,
            '2026-09-28T10:00:03Z'
        );
        RAISE EXCEPTION 'snapshot supply constraint did not reject a mismatch';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO "snapshots" (
    "id", "instrument_id", "corporate_action_id", "record_at",
    "network_genesis_hash", "solana_slot", "block_time",
    "canonical_json", "snapshot_hash", "holder_count",
    "total_balance", "mint_supply", "created_at"
) VALUES (
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '2026-09-28T10:00:00Z',
    '11111111111111111111111111111111',
    123456,
    '2026-09-28T10:00:02Z',
    '{}'::jsonb,
    decode(repeat('01', 32), 'hex'),
    1,
    35,
    35,
    '2026-09-28T10:00:03Z'
);

INSERT INTO "snapshot_holders" (
    "id", "snapshot_id", "wallet_address", "balance"
) VALUES (
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000004',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    35
);

INSERT INTO "snapshot_token_accounts" (
    "id", "snapshot_holder_id", "address", "balance"
) VALUES (
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000005',
    'So11111111111111111111111111111111111111112',
    35
);

UPDATE "snapshots"
SET "status" = 'FINALIZED'
WHERE "id" = '00000000-0000-4000-8000-000000000004';

DO $$
BEGIN
    BEGIN
        UPDATE "snapshots"
        SET "canonical_json" = '{"changed":true}'::jsonb
        WHERE "id" = '00000000-0000-4000-8000-000000000004';
        RAISE EXCEPTION 'finalized snapshot update was not rejected';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN NULL;
    END;

    BEGIN
        INSERT INTO "snapshot_holders" (
            "id", "snapshot_id", "wallet_address", "balance"
        ) VALUES (
            '00000000-0000-4000-8000-000000000007',
            '00000000-0000-4000-8000-000000000004',
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
            1
        );
        RAISE EXCEPTION 'holder insert into finalized snapshot was not rejected';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN NULL;
    END;

    BEGIN
        UPDATE "snapshot_token_accounts"
        SET "balance" = 34
        WHERE "id" = '00000000-0000-4000-8000-000000000006';
        RAISE EXCEPTION 'token-account update in finalized snapshot was not rejected';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN NULL;
    END;
END;
$$;

ROLLBACK;

SELECT 'PASS database constraints and finalized snapshot immutability' AS result;
