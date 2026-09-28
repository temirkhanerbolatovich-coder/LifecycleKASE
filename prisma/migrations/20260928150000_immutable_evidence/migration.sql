ALTER TABLE "corporate_actions"
    ADD CONSTRAINT "corporate_actions_approval_pair_check"
        CHECK (("approved_by_id" IS NULL) = ("approved_at" IS NULL)),
    ADD CONSTRAINT "corporate_actions_approved_status_check"
        CHECK (
            "status" NOT IN (
                'APPROVED', 'EXECUTING', 'PARTIALLY_SETTLED',
                'SETTLED', 'RECONCILING', 'FINALIZED'
            )
            OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL)
        );

ALTER TABLE "settlement_legs"
    ADD CONSTRAINT "settlement_legs_confirmation_check"
        CHECK (
            "status" <> 'CONFIRMED'
            OR ("actual_amount_minor" IS NOT NULL AND "confirmed_at" IS NOT NULL)
        );

ALTER TABLE "action_receipts"
    ADD CONSTRAINT "action_receipts_finalization_check"
        CHECK (
            ("status" = 'FINALIZED' AND "finalized_at" IS NOT NULL)
            OR ("status" = 'DRAFT' AND "finalized_at" IS NULL)
        );

CREATE FUNCTION "prevent_audit_log_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit events are append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_log_change"();

CREATE FUNCTION "prevent_finalized_action_receipt_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."status" = 'FINALIZED' THEN
        RAISE EXCEPTION 'finalized action receipt is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "action_receipts_prevent_finalized_change"
BEFORE UPDATE OR DELETE ON "action_receipts"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_action_receipt_change"();
