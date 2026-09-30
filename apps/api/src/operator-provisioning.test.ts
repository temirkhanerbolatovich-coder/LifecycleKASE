import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { encodePublicKey } from "@lifecycle-kase/solana-client";

import { OperatorProvisioningError, provisionOperator } from "./operator-provisioning.js";

function address(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return encodePublicKey(der.subarray(der.length - 32));
}

function fixture() {
  let user: any = null;
  let wallet: any = null;
  const auditEvents: any[] = [];
  const transaction = {
    wallet: {
      findUnique: async () => wallet,
      create: async ({ data }: any) => {
        wallet = { id: "00000000-0000-4000-8000-000000000002", investorId: null, revokedAt: null, ...data };
        return wallet;
      }
    },
    user: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        user = { id: "00000000-0000-4000-8000-000000000001", ...data };
        return user;
      }
    },
    auditLog: { create: async ({ data }: any) => { auditEvents.push(data); return data; } }
  };
  const database = {
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)
  } as unknown as PrismaClient;
  return {
    database,
    auditEvents,
    existing: () => {
      if (wallet) wallet.user = user;
      return { user, wallet };
    }
  };
}

const NOW = new Date("2026-09-30T12:00:00.000Z");

test("creates an active verified operator wallet and audit event", async () => {
  const setup = fixture();
  const walletAddress = address();
  const result = await provisionOperator(setup.database, {
    walletAddress,
    displayName: "Demo Administrator",
    normalizedEmail: "Admin@Example.com",
    role: "ADMINISTRATOR",
    network: "SOLANA_DEVNET",
    now: NOW,
    correlationId: "00000000-0000-4000-8000-000000000003"
  });
  assert.equal(result.created, true);
  assert.equal(result.walletAddress, walletAddress);
  assert.equal(setup.existing().user.normalizedEmail, "admin@example.com");
  assert.equal(setup.existing().wallet.status, "ACTIVE");
  assert.equal(setup.existing().wallet.verifiedAt, NOW);
  assert.deepEqual(setup.auditEvents[0].metadataJson, {
    walletAddress,
    walletNetwork: "SOLANA_DEVNET",
    role: "ADMINISTRATOR",
    source: "controlled-cli"
  });
});

test("is idempotent only for an exact active operator mapping", async () => {
  const setup = fixture();
  const input = {
    walletAddress: address(),
    displayName: "Demo Administrator",
    role: "ADMINISTRATOR" as const,
    network: "SOLANA_DEVNET",
    now: NOW
  };
  await provisionOperator(setup.database, input);
  setup.existing();
  const second = await provisionOperator(setup.database, input);
  assert.equal(second.created, false);
  assert.equal(setup.auditEvents.length, 1);

  setup.existing().wallet.status = "REVOKED";
  await assert.rejects(
    provisionOperator(setup.database, input),
    (error: unknown) => error instanceof OperatorProvisioningError && error.code === "WALLET_CONFLICT"
  );
});

test("rejects investor roles, unsupported networks, and invalid identity input", async () => {
  const setup = fixture();
  const base = {
    walletAddress: address(), displayName: "Operator", role: "ADMINISTRATOR" as const,
    network: "SOLANA_DEVNET", now: NOW
  };
  await assert.rejects(
    provisionOperator(setup.database, { ...base, role: "INVESTOR" }),
    (error: unknown) => error instanceof OperatorProvisioningError && error.code === "INVALID_OPERATOR_ROLE"
  );
  await assert.rejects(
    provisionOperator(setup.database, { ...base, network: "SOLANA_MAINNET" }),
    (error: unknown) => error instanceof OperatorProvisioningError && error.code === "INVALID_WALLET_NETWORK"
  );
  await assert.rejects(
    provisionOperator(setup.database, { ...base, normalizedEmail: "not-an-email" }),
    (error: unknown) => error instanceof OperatorProvisioningError && error.code === "INVALID_EMAIL"
  );
});
