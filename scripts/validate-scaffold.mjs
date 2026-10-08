import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const requiredPaths = [
  ".env.example",
  ".github/workflows/ci.yml",
  ".gitleaks.toml",
  "README.md",
  "apps/api/README.md",
  "apps/web/README.md",
  "docker-compose.yml",
  "docs/architecture/overview.md",
  "docs/architecture/data-flow.md",
  "docs/architecture/persistence.md",
  "docs/development/toolchain.md",
  "docs/decisions/ADR-001-token-authority.md",
  "docs/decisions/ADR-002-record-date-snapshot.md",
  "docs/decisions/ADR-003-atomic-entitlement-execution.md",
  "docs/decisions/ADR-004-source-of-truth.md",
  "docs/decisions/ADR-005-prisma-version.md",
  "docs/requirements/PRODUCT_REQUIREMENTS.md",
  "docs/requirements/TECHNICAL_REQUIREMENTS.md",
  "docs/testing/domain-contracts.md",
  "docs/testing/testing-strategy.md",
  "docs/security/security-model.md",
  "packages/domain/README.md",
  "packages/domain/package.json",
  "packages/domain/src/financial.ts",
  "packages/domain/src/snapshot.ts",
  "packages/solana-client/README.md",
  "prisma/README.md",
  "prisma/schema.prisma",
  "programs/lifecycle_kase/README.md",
  "scripts/test-solana-validator.ps1",
  "scripts/run-prisma.mjs",
  "tsconfig.base.json"
];

for (const relativePath of requiredPaths) {
  await access(path.join(root, relativePath), constants.R_OK);
}

const decisionFiles = requiredPaths.filter((entry) => entry.includes("ADR-"));
for (const relativePath of decisionFiles) {
  const contents = await readFile(path.join(root, relativePath), "utf8");
  if (!contents.includes("Status: Accepted")) {
    throw new Error(`${relativePath} is not an accepted decision`);
  }
}

const envExample = await readFile(path.join(root, ".env.example"), "utf8");
if (/PRIVATE_KEY|SECRET_KEY|MNEMONIC/i.test(envExample)) {
  throw new Error(".env.example must not define private-key or mnemonic variables");
}

console.log(`PASS repository scaffold (${requiredPaths.length} required paths)`);
