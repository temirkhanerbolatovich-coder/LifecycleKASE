# API boundary

This directory will contain the NestJS orchestration API. It will own authentication, role checks, workflow transitions, canonical snapshot persistence, transaction preparation and confirmation, and reconciliation orchestration. It must not store administrator private keys or redefine on-chain ownership.

Implementation starts in the API milestone after the database schema and Anchor interfaces are fixed.
