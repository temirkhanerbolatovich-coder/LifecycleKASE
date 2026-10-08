import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { authOptionsFromEnvironment } from "../apps/api/dist/auth.js";
import {
  attachPendingWallet,
  createInvestor,
  decideInvestorEligibility
} from "../apps/api/dist/investor-registry.js";
import {
  createWalletVerificationChallenge,
  verifyWalletOwnership
} from "../apps/api/dist/wallet-verification.js";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const databaseName = databaseUrl.pathname.slice(1);
if (databaseUrl.protocol !== "postgresql:" || !allowedHosts.has(databaseUrl.hostname) ||
    !/^lifecycle_kase(?:_acceptance_[a-z0-9_]+)?$/.test(databaseName) || !databaseUrl.port) {
  throw new Error("Acceptance fixtures require lifecycle_kase or a lifecycle_kase_acceptance_* database on an explicit loopback port");
}
if (process.env.SOLANA_CLUSTER !== "localnet" || process.env.WALLET_NETWORK !== "SOLANA_LOCALNET") {
  throw new Error("Acceptance fixtures require SOLANA_CLUSTER=localnet and WALLET_NETWORK=SOLANA_LOCALNET");
}

const administratorWallet = process.env.ACCEPTANCE_ADMIN_WALLET?.trim();
if (!administratorWallet) throw new Error("ACCEPTANCE_ADMIN_WALLET is required");
const runId = process.env.ACCEPTANCE_RUN_ID?.trim() || new Date().toISOString().replace(/\D/g, "").slice(0, 14);
if (!/^[A-Za-z0-9-]{4,32}$/.test(runId)) {
  throw new Error("ACCEPTANCE_RUN_ID must contain 4 to 32 ASCII letters, digits or hyphens");
}

const database = new PrismaClient();
const origin = "http://localhost:3000";
const authOptions = authOptionsFromEnvironment({
  ...process.env,
  AUTH_DOMAIN: "localhost:3000",
  AUTH_ALLOWED_ORIGINS: origin
});

function actor(userId) {
  return { id: userId, walletAddress: administratorWallet, correlationId: randomUUID() };
}

async function createAcceptanceInvestor(userId, allocation) {
  const externalReference = `LOCAL-ACCEPT-${runId}-${allocation}`;
  const existing = await database.investor.findUnique({
    where: { externalReference },
    include: { wallets: true }
  });
  if (existing) {
    const wallet = existing.wallets.find(item => item.status === "ACTIVE" && item.verifiedAt && !item.revokedAt);
    if (existing.status !== "ACTIVE" || existing.eligibilityStatus !== "ELIGIBLE" || !wallet) {
      throw new Error(`Existing fixture ${externalReference} is incomplete and must not be reused`);
    }
    return { investorId: existing.id, walletAddress: wallet.address, allocation, reused: true };
  }

  const keypair = generateKeyPairSync("ed25519");
  const publicDer = keypair.publicKey.export({ type: "spki", format: "der" });
  const walletAddress = encodePublicKey(publicDer.subarray(-32));
  const investor = await createInvestor(database, {
    displayName: `Localnet Acceptance Investor ${allocation}`,
    type: "INDIVIDUAL",
    countryCode: "KZ",
    externalReference
  }, actor(userId));
  const wallet = await attachPendingWallet(database, investor.id, { address: walletAddress }, actor(userId));
  const challenge = await createWalletVerificationChallenge(
    database,
    investor.id,
    wallet.id,
    actor(userId),
    origin,
    new Date(),
    authOptions
  );
  const signature = sign(null, Buffer.from(challenge.message, "utf8"), keypair.privateKey).toString("base64");
  await verifyWalletOwnership(database, investor.id, wallet.id, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signature
  }, actor(userId), origin, new Date(), authOptions);
  await decideInvestorEligibility(database, investor.id, {
    decision: "ELIGIBLE",
    reasonCode: "DEMO_CRITERIA_MET"
  }, actor(userId));
  return { investorId: investor.id, walletAddress, allocation, reused: false };
}

try {
  const administrator = await database.wallet.findUnique({
    where: { address: administratorWallet },
    include: { user: true }
  });
  if (!administrator?.user || administrator.user.role !== "ADMINISTRATOR" ||
      administrator.network !== "SOLANA_LOCALNET" || administrator.status !== "ACTIVE" ||
      !administrator.verifiedAt || administrator.revokedAt) {
    throw new Error("ACCEPTANCE_ADMIN_WALLET must belong to an active verified Localnet administrator");
  }

  const investors = [];
  for (const allocation of [10, 20, 5]) {
    investors.push(await createAcceptanceInvestor(administrator.user.id, allocation));
  }
  console.log(JSON.stringify({ runId, administratorWallet, investors }, null, 2));
} finally {
  await database.$disconnect();
}
