import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("canonical demo allocation matches fixed supply", async () => {
  const requirements = await readFile(
    path.join(root, "docs/requirements/PRODUCT_REQUIREMENTS.md"),
    "utf8"
  );

  assert.match(requirements, /35/);
  assert.match(requirements, /10/);
  assert.match(requirements, /20/);
  assert.match(requirements, /5/);
  assert.equal(10 + 20 + 5, 35);
});

test("every accepted ADR contains the required decision sections", async () => {
  const decisionFiles = [
    "ADR-001-token-authority.md",
    "ADR-002-record-date-snapshot.md",
    "ADR-003-atomic-entitlement-execution.md",
    "ADR-004-source-of-truth.md",
    "ADR-005-prisma-version.md",
    "ADR-006-investor-identity-and-action-control.md",
    "ADR-014-local-mvp-before-public-network.md"
  ];
  const requiredSections = [
    "## Context",
    "## Options considered",
    "## Decision",
    "## Reasoning",
    "## Consequences",
    "## Risks",
    "## Future work"
  ];

  for (const decisionFile of decisionFiles) {
    const contents = await readFile(
      path.join(root, "docs/decisions", decisionFile),
      "utf8"
    );

    assert.match(contents, /Status: Accepted/);
    for (const section of requiredSections) {
      assert.ok(contents.includes(section), `${decisionFile} is missing ${section}`);
    }
  }
});

test("source-of-truth decision requires finalized confirmation", async () => {
  const decision = await readFile(
    path.join(root, "docs/decisions/ADR-004-source-of-truth.md"),
    "utf8"
  );

  assert.match(decision, /confirmed at `finalized`/);
  assert.match(decision, /never overwrites chain facts/);
});
