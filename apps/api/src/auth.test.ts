import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import type { PrismaClient, UserRole, WalletStatus } from "@prisma/client";
import { encodePublicKey } from "@lifecycle-kase/solana-client";

import {
  AuthFlowError,
  authOptionsFromEnvironment,
  createOperatorChallenge,
  readOperatorSession,
  requireAuthenticationEnabled,
  revokeOperatorSession,
  verifyOperatorChallenge
} from "./auth.js";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const ORIGIN = "https://lifecyclekase.example";
const options = {
  domain: "lifecyclekase.example",
  allowedOrigins: [ORIGIN],
  challengeTtlSeconds: 300,
  sessionTtlSeconds: 3600
};

function fixture(overrides: { role?: UserRole; verified?: boolean } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const walletAddress = encodePublicKey(publicDer.subarray(publicDer.length - 32));
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    displayName: "Demo Operator",
    role: overrides.role ?? "ADMINISTRATOR"
  };
  const wallet = {
    address: walletAddress,
    userId: user.id as string | null,
    status: "ACTIVE" as WalletStatus,
    verifiedAt: overrides.verified === false ? null : new Date("2026-09-29T00:00:00.000Z"),
    revokedAt: null as Date | null,
    user
  };
  let currentWallet: typeof wallet | null = wallet;
  const challenges = new Map<string, any>();
  const sessions = new Map<string, any>();
  const tx = {
    wallet: { findUnique: async () => currentWallet },
    authChallenge: {
      updateMany: async ({ where, data }: any) => {
        const challenge = challenges.get(where.id);
        if (!challenge || challenge.usedAt !== null || challenge.expiresAt <= where.expiresAt.gt) return { count: 0 };
        assert.ok(data.usedAt >= challenge.createdAt, "Stored challenge creation must not be later than consumption");
        challenge.usedAt = data.usedAt;
        return { count: 1 };
      }
    },
    session: {
      create: async ({ data }: any) => {
        const id = "00000000-0000-4000-8000-000000000010";
        sessions.set(Buffer.from(data.tokenHash).toString("hex"), { id, ...data, user, revokedAt: null });
        return { id };
      }
    }
  };
  const database = {
    wallet: { findUnique: async () => currentWallet },
    authChallenge: {
      create: async ({ data }: any) => {
        challenges.set(data.id, { ...data, createdAt: data.createdAt ?? new Date(NOW.getTime() + 2), usedAt: null });
      },
      findUnique: async ({ where }: any) => challenges.get(where.id) ?? null
    },
    session: {
      findUnique: async ({ where }: any) => sessions.get(Buffer.from(where.tokenHash).toString("hex")) ?? null,
      updateMany: async ({ where, data }: any) => {
        const session = sessions.get(Buffer.from(where.tokenHash).toString("hex"));
        if (!session || session.revokedAt !== null) return { count: 0 };
        session.revokedAt = data.revokedAt;
        return { count: 1 };
      }
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient;
  return { database, privateKey, walletAddress, wallet, challenges, sessions,
    removeWallet: () => { currentWallet = null; } };
}

async function authenticatedFixture() {
  const setup = fixture();
  const challenge = await createOperatorChallenge(setup.database, {
    walletAddress: setup.walletAddress, origin: ORIGIN, now: NOW
  }, options);
  const result = await verifyOperatorChallenge(setup.database, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signature: sign(null, Buffer.from(challenge.message), setup.privateKey).toString("base64"),
    origin: ORIGIN,
    now: NOW
  }, options);
  return { ...setup, sessionToken: result.sessionToken };
}

const walletInvalidations: ReadonlyArray<{
  name: string;
  apply: (setup: Awaited<ReturnType<typeof authenticatedFixture>>) => void;
}> = [
  { name: "blocked", apply: setup => { setup.wallet.status = "BLOCKED"; } },
  { name: "pending", apply: setup => { setup.wallet.status = "PENDING"; } },
  { name: "revoked", apply: setup => { setup.wallet.status = "REVOKED"; setup.wallet.revokedAt = NOW; } },
  { name: "deleted", apply: setup => { setup.removeWallet(); } },
  { name: "reassigned", apply: setup => { setup.wallet.userId = "00000000-0000-4000-8000-000000000002"; } },
  { name: "detached from the user", apply: setup => { setup.wallet.userId = null; } },
  { name: "unverified", apply: setup => { setup.wallet.verifiedAt = null; } },
  { name: "revoked without a status update", apply: setup => { setup.wallet.revokedAt = NOW; } }
];

for (const invalidation of walletInvalidations) {
  test(`rejects an existing operator session after its wallet is ${invalidation.name}`, async () => {
    const setup = await authenticatedFixture();
    assert.equal((await readOperatorSession(setup.database, setup.sessionToken, NOW)).walletAddress, setup.walletAddress);
    invalidation.apply(setup);
    await assert.rejects(readOperatorSession(setup.database, setup.sessionToken, NOW),
      (error: unknown) => error instanceof AuthFlowError && error.code === "SESSION_INVALID" && error.status === 401);
  });
}

test("an active verified wallet cannot extend an expired operator session", async () => {
  const setup = await authenticatedFixture();
  await assert.rejects(readOperatorSession(setup.database, setup.sessionToken,
    new Date(NOW.getTime() + options.sessionTtlSeconds * 1000)),
  (error: unknown) => error instanceof AuthFlowError && error.code === "SESSION_INVALID" && error.status === 401);
});

test("creates a domain-bound challenge and one-time operator session", async () => {
  const setup = fixture();
  const challenge = await createOperatorChallenge(setup.database, {
    walletAddress: setup.walletAddress, origin: ORIGIN, now: NOW
  }, options);
  assert.match(challenge.message, /does not submit a transaction or authorize a payment/);
  assert.equal(challenge.message.includes(challenge.nonce), true);
  const storedChallenge = setup.challenges.get(challenge.challengeId);
  assert.equal(storedChallenge.createdAt.getTime(), NOW.getTime());
  assert.equal(storedChallenge.expiresAt.getTime() - storedChallenge.createdAt.getTime(), options.challengeTtlSeconds * 1000);
  assert.notEqual(Buffer.from(storedChallenge.nonceHash).toString("hex"), challenge.nonce);
  assert.equal(
    Buffer.from(storedChallenge.nonceHash).toString("hex"),
    createHash("sha256").update(challenge.nonce).digest("hex")
  );

  const signature = sign(null, Buffer.from(challenge.message), setup.privateKey).toString("base64");
  const verified = await verifyOperatorChallenge(setup.database, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signature,
    origin: ORIGIN,
    now: new Date("2026-09-30T10:01:00.000Z")
  }, options);
  assert.equal(verified.user.role, "ADMINISTRATOR");
  assert.equal(setup.sessions.size, 1);
  const storedSession = [...setup.sessions.values()][0];
  assert.equal(storedSession.createdAt.getTime(), Date.parse("2026-09-30T10:01:00.000Z"));
  assert.equal(storedSession.expiresAt.getTime() - storedSession.createdAt.getTime(), options.sessionTtlSeconds * 1000);
  assert.equal([...setup.sessions.keys()][0], createHash("sha256").update(verified.sessionToken).digest("hex"));

  const session = await readOperatorSession(
    setup.database, verified.sessionToken, new Date("2026-09-30T10:02:00.000Z")
  );
  assert.equal(session.user.id, verified.user.id);
  assert.equal(session.walletAddress, setup.walletAddress);
  await revokeOperatorSession(setup.database, verified.sessionToken, new Date("2026-09-30T10:03:00.000Z"));
  await assert.rejects(
    readOperatorSession(setup.database, verified.sessionToken, new Date("2026-09-30T10:04:00.000Z")),
    (error: unknown) => error instanceof AuthFlowError && error.code === "SESSION_INVALID"
  );
});

test("rejects replay, wrong origin, invalid signature, and unauthorized role", async () => {
  const setup = fixture();
  const challenge = await createOperatorChallenge(setup.database, {
    walletAddress: setup.walletAddress, origin: ORIGIN, now: NOW
  }, options);
  const signature = sign(null, Buffer.from(challenge.message), setup.privateKey).toString("base64");
  await assert.rejects(
    verifyOperatorChallenge(setup.database, {
      challengeId: challenge.challengeId, nonce: challenge.nonce, signature,
      origin: "https://evil.example", now: NOW
    }, options),
    (error: unknown) => error instanceof AuthFlowError && error.code === "ORIGIN_NOT_ALLOWED"
  );
  await assert.rejects(
    verifyOperatorChallenge(setup.database, {
      challengeId: challenge.challengeId, nonce: challenge.nonce,
      signature: Buffer.alloc(64).toString("base64"), origin: ORIGIN, now: NOW
    }, options),
    (error: unknown) => error instanceof AuthFlowError && error.code === "INVALID_SIGNATURE"
  );
  await verifyOperatorChallenge(setup.database, {
    challengeId: challenge.challengeId, nonce: challenge.nonce, signature, origin: ORIGIN, now: NOW
  }, options);
  await assert.rejects(
    verifyOperatorChallenge(setup.database, {
      challengeId: challenge.challengeId, nonce: challenge.nonce, signature, origin: ORIGIN, now: NOW
    }, options),
    (error: unknown) => error instanceof AuthFlowError && error.code === "INVALID_CHALLENGE"
  );

  const investor = fixture({ role: "INVESTOR" });
  await assert.rejects(
    createOperatorChallenge(investor.database, {
      walletAddress: investor.walletAddress, origin: ORIGIN, now: NOW
    }, options),
    (error: unknown) => error instanceof AuthFlowError && error.code === "UNAUTHORIZED_WALLET"
  );
});

test("validates authentication configuration and wallet proof prerequisites", async () => {
  assert.deepEqual(authOptionsFromEnvironment({ AUTH_DOMAIN: "example.com", AUTH_ALLOWED_ORIGINS: ORIGIN }), {
    domain: "example.com",
    allowedOrigins: [ORIGIN],
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600
  });
  assert.throws(
    () => authOptionsFromEnvironment({ AUTH_ALLOWED_ORIGINS: "javascript:alert(1)" }),
    (error: unknown) => error instanceof AuthFlowError && error.code === "AUTH_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => requireAuthenticationEnabled({}),
    (error: unknown) => error instanceof AuthFlowError && error.code === "AUTH_NOT_CONFIGURED"
  );
  assert.doesNotThrow(() => requireAuthenticationEnabled({ AUTH_ENABLED: "true" }));
  const unverified = fixture({ verified: false });
  await assert.rejects(
    createOperatorChallenge(unverified.database, {
      walletAddress: unverified.walletAddress, origin: ORIGIN, now: NOW
    }, options),
    (error: unknown) => error instanceof AuthFlowError && error.code === "UNAUTHORIZED_WALLET"
  );
});
