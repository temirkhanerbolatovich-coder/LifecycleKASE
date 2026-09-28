BEGIN;

INSERT INTO users (id, role, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'ADMINISTRATOR', CURRENT_TIMESTAMP);
INSERT INTO issuers (id, legal_name, updated_at)
VALUES ('00000000-0000-4000-8000-000000000002', 'LifecycleKASE Test Issuer', CURRENT_TIMESTAMP);
INSERT INTO settlement_assets (id, code, name, disclaimer, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000003',
    'KZT_TEST',
    'KZT-Test',
    'SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.',
    CURRENT_TIMESTAMP
);
INSERT INTO investors (id, display_name, type, country_code, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000004',
    'Investor A',
    'INDIVIDUAL',
    'KZ',
    CURRENT_TIMESTAMP
);
INSERT INTO wallets (id, address, investor_id, status, verified_at)
VALUES (
    '00000000-0000-4000-8000-000000000005',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    '00000000-0000-4000-8000-000000000004',
    'ACTIVE',
    CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        INSERT INTO wallets (id, address)
        VALUES ('00000000-0000-4000-8000-000000000099', '11111111111111111111111111111111');
        RAISE EXCEPTION 'unowned wallet accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO wallets (id, address, investor_id, status)
        VALUES (
            '00000000-0000-4000-8000-000000000098',
            '11111111111111111111111111111111',
            '00000000-0000-4000-8000-000000000004',
            'ACTIVE'
        );
        RAISE EXCEPTION 'unverified active wallet accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO instruments (
    id, issuer_id, settlement_asset_id, name, ticker,
    issuer_authority, compliance_authority, corporate_action_authority,
    face_value_minor, coupon_rate_bps, payments_per_year,
    issue_at, maturity_at, total_supply, circulating_supply, updated_at
) VALUES (
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'Canonical Demo Bond',
    'KDB26',
    '11111111111111111111111111111111',
    '11111111111111111111111111111111',
    '11111111111111111111111111111111',
    1000000000, 1000, 2,
    '2026-01-01T00:00:00Z',
    '2027-01-01T00:00:00Z',
    35, 35, CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        UPDATE instruments SET currency = 'USD_TEST'
        WHERE id = '00000000-0000-4000-8000-000000000006';
        RAISE EXCEPTION 'non-KZT demo currency accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO corporate_actions (
    id, instrument_id, type, intent, created_by_id,
    record_at, execute_at, eligible_holders, updated_at
) VALUES (
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000006',
    'COUPON_PAYMENT',
    'Pay scheduled semi-annual coupon',
    '00000000-0000-4000-8000-000000000001',
    '2026-09-28T10:00:00Z',
    '2026-09-28T11:00:00Z',
    1,
    CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        INSERT INTO snapshots (
            id, instrument_id, corporate_action_id, record_at,
            network_genesis_hash, solana_slot, block_time, canonical_json,
            snapshot_hash, investor_count, wallet_count,
            total_balance, mint_supply, created_at
        ) VALUES (
            '00000000-0000-4000-8000-000000000097',
            '00000000-0000-4000-8000-000000000006',
            '00000000-0000-4000-8000-000000000007',
            '2026-09-28T10:00:00Z',
            '11111111111111111111111111111111',
            123456, '2026-09-28T10:00:02Z',
            '{}'::jsonb, decode(repeat('00', 32), 'hex'),
            1, 1, 34, 35, '2026-09-28T10:00:03Z'
        );
        RAISE EXCEPTION 'snapshot supply mismatch accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO snapshots (
    id, instrument_id, corporate_action_id, record_at,
    network_genesis_hash, solana_slot, block_time, canonical_json,
    snapshot_hash, investor_count, wallet_count,
    total_balance, mint_supply, created_at
) VALUES (
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
    '2026-09-28T10:00:00Z',
    '11111111111111111111111111111111',
    123456, '2026-09-28T10:00:02Z',
    '{}'::jsonb, decode(repeat('01', 32), 'hex'),
    1, 1, 35, 35, '2026-09-28T10:00:03Z'
);
INSERT INTO snapshot_investors (id, snapshot_id, investor_id, eligibility_status, balance)
VALUES (
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000004',
    'ELIGIBLE', 35
);
INSERT INTO snapshot_wallets (
    id, snapshot_investor_id, wallet_id, wallet_address, wallet_status, balance
) VALUES (
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000005',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    'ACTIVE', 35
);
INSERT INTO snapshot_token_accounts (id, snapshot_wallet_id, address, balance)
VALUES (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000010',
    'So11111111111111111111111111111111111111112',
    35
);
UPDATE snapshots SET status = 'FINALIZED'
WHERE id = '00000000-0000-4000-8000-000000000008';

DO $$
BEGIN
    BEGIN
        UPDATE snapshots SET canonical_json = '{"changed":true}'::jsonb
        WHERE id = '00000000-0000-4000-8000-000000000008';
        RAISE EXCEPTION 'finalized snapshot update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
    BEGIN
        UPDATE snapshot_investors SET balance = 34
        WHERE id = '00000000-0000-4000-8000-000000000009';
        RAISE EXCEPTION 'finalized investor update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
    BEGIN
        UPDATE snapshot_wallets SET balance = 34
        WHERE id = '00000000-0000-4000-8000-000000000010';
        RAISE EXCEPTION 'finalized wallet update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
    BEGIN
        UPDATE snapshot_token_accounts SET balance = 34
        WHERE id = '00000000-0000-4000-8000-000000000011';
        RAISE EXCEPTION 'finalized token account update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
END;
$$;

INSERT INTO entitlements (
    id, corporate_action_id, snapshot_investor_id, investor_id,
    settlement_wallet_address, balance_at_record_date, amount_minor,
    calculation_inputs, formula_version, eligibility_reason, updated_at
) VALUES (
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000004',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    35, 1750000000,
    '{"balance":"35","faceValueMinor":"1000000000","couponRateBps":1000,"paymentsPerYear":2}'::jsonb,
    'coupon-v1',
    'ELIGIBLE',
    CURRENT_TIMESTAMP
);
INSERT INTO settlements (id, entitlement_id, amount_minor, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000012',
    1750000000,
    CURRENT_TIMESTAMP
);
INSERT INTO settlement_legs (
    id, settlement_id, type, required, status, expected_amount_minor, updated_at
) VALUES (
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000013',
    'CASH', true, 'PENDING', 1750000000, CURRENT_TIMESTAMP
);
DO $$
BEGIN
    BEGIN
        INSERT INTO settlement_legs (
            id, settlement_id, type, required, status, expected_amount_minor, updated_at
        ) VALUES (
            '00000000-0000-4000-8000-000000000015',
            '00000000-0000-4000-8000-000000000013',
            'ASSET', false, 'PENDING', 0, CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'non-required pending leg accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;
INSERT INTO settlement_legs (
    id, settlement_id, type, required, status, expected_amount_minor, updated_at
) VALUES (
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000013',
    'ASSET', false, 'NOT_APPLICABLE', 0, CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        UPDATE corporate_actions SET status = 'APPROVED'
        WHERE id = '00000000-0000-4000-8000-000000000007';
        RAISE EXCEPTION 'action approved without approver';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE settlement_legs SET status = 'CONFIRMED'
        WHERE id = '00000000-0000-4000-8000-000000000014';
        RAISE EXCEPTION 'leg confirmed without actual amount and timestamp';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO audit_logs (
    id, actor_id, event, entity_type, entity_id, correlation_id, metadata_json
) VALUES (
    '00000000-0000-4000-8000-000000000017',
    '00000000-0000-4000-8000-000000000001',
    'ACTION_CREATED', 'CORPORATE_ACTION',
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000018',
    '{}'::jsonb
);
INSERT INTO action_receipts (
    id, corporate_action_id, status, payload_json, payload_hash, finalized_at
) VALUES (
    '00000000-0000-4000-8000-000000000019',
    '00000000-0000-4000-8000-000000000007',
    'FINALIZED',
    '{}'::jsonb,
    decode(repeat('02', 32), 'hex'),
    CURRENT_TIMESTAMP
);
DO $$
BEGIN
    BEGIN
        UPDATE audit_logs SET metadata_json = '{"changed":true}'::jsonb
        WHERE id = '00000000-0000-4000-8000-000000000017';
        RAISE EXCEPTION 'audit event update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
    BEGIN
        UPDATE action_receipts SET payload_json = '{"changed":true}'::jsonb
        WHERE id = '00000000-0000-4000-8000-000000000019';
        RAISE EXCEPTION 'finalized receipt update accepted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
END;
$$;

ROLLBACK;
SELECT 'PASS investor registry, snapshot-v2, settlement and immutable evidence guards' AS result;
