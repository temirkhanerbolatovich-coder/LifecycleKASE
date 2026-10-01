ALTER TABLE "investors"
    ADD COLUMN "eligibility_reason_code" VARCHAR(50),
    ADD COLUMN "eligibility_reviewed_at" TIMESTAMPTZ(6);

-- Preserve explicit statuses created by older fixtures without inventing a human review.
UPDATE "investors"
SET "eligibility_reason_code" = 'LEGACY_STATUS_IMPORT',
    "eligibility_reviewed_at" = "updated_at"
WHERE "eligibility_status" <> 'PENDING_REVIEW';

ALTER TABLE "investors"
    ADD CONSTRAINT "investors_eligibility_review_check"
    CHECK (
        ("eligibility_status" = 'PENDING_REVIEW'
            AND "eligibility_reason_code" IS NULL
            AND "eligibility_reviewed_at" IS NULL)
        OR
        ("eligibility_status" <> 'PENDING_REVIEW'
            AND "eligibility_reason_code" IS NOT NULL
            AND "eligibility_reviewed_at" IS NOT NULL)
    );
