import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { InvestorRegistryError } from "./investor-registry.js";
import { createWalletVerificationChallenge, verifyWalletOwnership } from "./wallet-verification.js";

const INVESTOR_ID = "00000000-0000-4000-8000-000000000001";
const WALLET_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const ORIGIN = "http://localhost:3000";
const options = { domain: "localhost:3000", allowedOrigins: [ORIGIN], challengeTtlSeconds: 300, sessionTtlSeconds: 3600 };
const actor = { id: ACTOR_ID, walletAddress: "11111111111111111111111111111111", correlationId: ACTOR_ID };

function fixture() {
  const keypair = generateKeyPairSync("ed25519");
  const publicDer = keypair.publicKey.export({ type: "spki", format: "der" });
  const address = encodePublicKey(publicDer.subarray(-32));
  let state = {
    wallet: { id: WALLET_ID, investorId: INVESTOR_ID, address, network: "SOLANA_LOCALNET",
      status: "PENDING", verifiedAt: null as Date | null, revokedAt: null as Date | null,
      investor: { status: "ACTIVE" } },
    challenges: new Map<string, any>(),
    audit: [] as any[]
  };
  let failAudit = false;
  const tx = {
    wallet: {
      findFirst: async ({ where }: any) => state.wallet.id === where.id && state.wallet.investorId === where.investorId ? state.wallet : null,
      update: async ({ data }: any) => Object.assign(state.wallet, data)
    },
    authChallenge: {
      findUnique: async ({ where }: any) => state.challenges.get(where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const value = state.challenges.get(where.id);
        if (!value || value.usedAt !== null || value.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(value, data);
        return { count: 1 };
      }
    },
    auditLog: { create: async ({ data }: any) => {
      if (failAudit) throw new Error("synthetic audit failure");
      state.audit.push(data);
      return data;
    } }
  };
  const database = {
    wallet: tx.wallet,
    authChallenge: {
      ...tx.authChallenge,
      create: async ({ data }: any) => { state.challenges.set(data.id, { ...data, usedAt: null }); return data; }
    },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>, settings: any) => {
      assert.equal(settings.isolationLevel, "Serializable");
      const before = structuredClone(state);
      try { return await callback(tx); } catch (error) { state = before; throw error; }
    }
  } as unknown as PrismaClient;
  return { database, keypair, state: () => state, failAudit: () => { failAudit = true; } };
}

function code(expected: string) {
  return (error: unknown) => error instanceof InvestorRegistryError && error.code === expected;
}

async function proof(f: ReturnType<typeof fixture>, overrideActor = actor) {
  const challenge = await createWalletVerificationChallenge(
    f.database, INVESTOR_ID, WALLET_ID, overrideActor, ORIGIN, NOW, options
  );
  const signature = sign(null, Buffer.from(challenge.message), f.keypair.privateKey).toString("base64");
  return { challenge, body: { challengeId: challenge.challengeId, nonce: challenge.nonce, signature } };
}

test("activates a pending localnet wallet only after its exact Ed25519 proof and atomic audit", async () => {
  const f = fixture();
  const { challenge, body } = await proof(f);
  assert.match(challenge.message, /does not submit a transaction, approve eligibility, or authorize a payment/);
  const verified = await verifyWalletOwnership(f.database, INVESTOR_ID, WALLET_ID, body, actor, ORIGIN, NOW, options);
  assert.equal(verified.status, "ACTIVE");
  assert.equal(verified.verifiedAt, NOW);
  assert.equal(f.state().audit[0].event, "INVESTOR_WALLET_OWNERSHIP_VERIFIED");
  assert.equal(f.state().audit[0].actorId, ACTOR_ID);
  assert.equal(f.state().audit[0].metadataJson.investorId, INVESTOR_ID);
  assert.equal("address" in f.state().audit[0].metadataJson, false);
  await assert.rejects(
    verifyWalletOwnership(f.database, INVESTOR_ID, WALLET_ID, body, actor, ORIGIN, NOW, options),
    code("INVALID_VERIFICATION")
  );
});

test("binds proof to the administrator, wallet, origin, nonce and signature", async () => {
  for (const mutate of [
    (value: any) => ({ ...value, actor: { ...actor, id: "00000000-0000-4000-8000-000000000004" } }),
    (value: any) => ({ ...value, origin: "https://untrusted.example" }),
    (value: any) => ({ ...value, body: { ...value.body, nonce: "x".repeat(43) } }),
    (value: any) => ({ ...value, body: { ...value.body, signature: Buffer.alloc(64).toString("base64") } })
  ]) {
    const f = fixture();
    const { body } = await proof(f);
    const changed = mutate({ body, actor, origin: ORIGIN });
    await assert.rejects(
      verifyWalletOwnership(f.database, INVESTOR_ID, WALLET_ID, changed.body, changed.actor, changed.origin, NOW, options),
      (error: unknown) => error instanceof InvestorRegistryError && ["INVALID_VERIFICATION", "INVALID_SIGNATURE"].includes(error.code)
    );
    assert.equal(f.state().wallet.status, "PENDING");
  }
});

test("rejects non-pending/inactive/wrong-scope wallets and malformed identifiers", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state().wallet.status = "ACTIVE"; f.state().wallet.verifiedAt = NOW; },
    (f: ReturnType<typeof fixture>) => { f.state().wallet.investor.status = "CLOSED"; },
    (f: ReturnType<typeof fixture>) => { f.state().wallet.network = "SOLANA_DEVNET"; }
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(
      createWalletVerificationChallenge(f.database, INVESTOR_ID, WALLET_ID, actor, ORIGIN, NOW, options),
      (error: unknown) => error instanceof InvestorRegistryError && ["WALLET_NOT_PENDING", "INVESTOR_INACTIVE"].includes(error.code)
    );
  }
  await assert.rejects(
    createWalletVerificationChallenge({} as PrismaClient, "invalid", WALLET_ID, actor, ORIGIN, NOW, options),
    code("INVALID_REQUEST")
  );
});

test("rolls back challenge consumption and wallet activation when audit persistence fails", async () => {
  const f = fixture();
  const { challenge, body } = await proof(f);
  f.failAudit();
  await assert.rejects(
    verifyWalletOwnership(f.database, INVESTOR_ID, WALLET_ID, body, actor, ORIGIN, NOW, options),
    /synthetic audit failure/
  );
  assert.equal(f.state().wallet.status, "PENDING");
  assert.equal(f.state().challenges.get(challenge.challengeId).usedAt, null);
});
