import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { decodePublicKey } from "@lifecycle-kase/solana-client";
import type { AuthRuntimeOptions } from "./auth.js";
import { InvestorRegistryError, REGISTRY_UUID, type RegistryActor } from "./investor-registry.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const walletSelect = { id: true, address: true, network: true, status: true, verifiedAt: true, revokedAt: true } as const;

function invalid(code: string, message: string, status = 400): never {
  throw new InvestorRegistryError(code, message, status);
}

function validIdentifiers(investorId: string, walletId: string): void {
  if (!REGISTRY_UUID.test(investorId) || !REGISTRY_UUID.test(walletId)) {
    invalid("INVALID_REQUEST", "Investor and wallet IDs must be UUIDs");
  }
}

function validNow(now: Date): void {
  if (!Number.isFinite(now.getTime())) invalid("INVALID_TIME", "Wallet verification time is invalid", 500);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function verificationMessage(input: {
  domain: string;
  origin: string;
  investorId: string;
  walletId: string;
  walletAddress: string;
  challengeId: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    "LifecycleKASE investor wallet ownership verification",
    `Domain: ${input.domain}`,
    `Origin: ${input.origin}`,
    `Investor ID: ${input.investorId}`,
    `Wallet ID: ${input.walletId}`,
    `Wallet: ${input.walletAddress}`,
    `Challenge ID: ${input.challengeId}`,
    `Nonce: ${input.nonce}`,
    `Expires At: ${input.expiresAt.toISOString()}`,
    "This request does not submit a transaction, approve eligibility, or authorize a payment."
  ].join("\n");
}

function payload(body: unknown): { challengeId: string; nonce: string; signature: Buffer } {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("INVALID_REQUEST", "A JSON object is required");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["challengeId", "nonce", "signature"].includes(key)) ||
      typeof value.challengeId !== "string" || !REGISTRY_UUID.test(value.challengeId) ||
      typeof value.nonce !== "string" || value.nonce.length < 40 || value.nonce.length > 64 ||
      typeof value.signature !== "string" || value.signature.length < 80 || value.signature.length > 100) {
    invalid("INVALID_VERIFICATION", "Wallet verification proof is invalid", 401);
  }
  const signature = Buffer.from(value.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== value.signature) {
    invalid("INVALID_VERIFICATION", "Wallet verification proof is invalid", 401);
  }
  return { challengeId: value.challengeId, nonce: value.nonce, signature };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new InvestorRegistryError("REGISTRY_CONFLICT", "Concurrent change; refresh before retrying", 409);
  }
  throw error;
}

export async function createWalletVerificationChallenge(
  database: PrismaClient,
  investorId: string,
  walletId: string,
  actor: RegistryActor,
  origin: string,
  now: Date,
  options: AuthRuntimeOptions
) {
  validIdentifiers(investorId, walletId);
  validNow(now);
  const wallet = await database.wallet.findFirst({
    where: { id: walletId, investorId },
    include: { investor: { select: { status: true } } }
  });
  if (!wallet) invalid("WALLET_NOT_FOUND", "Investor wallet not found", 404);
  if (wallet.investor?.status !== "ACTIVE") invalid("INVESTOR_INACTIVE", "Investor is not active", 409);
  if (wallet.network !== "SOLANA_LOCALNET" || wallet.status !== "PENDING" || wallet.verifiedAt !== null || wallet.revokedAt !== null) {
    invalid("WALLET_NOT_PENDING", "Only an unverified pending localnet wallet can be verified", 409);
  }
  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + options.challengeTtlSeconds * 1000);
  const message = verificationMessage({
    domain: options.domain, origin, investorId, walletId, walletAddress: wallet.address,
    challengeId, nonce, expiresAt
  });
  await database.authChallenge.create({ data: {
    id: challengeId,
    userId: actor.id,
    walletId,
    purpose: "INVESTOR_WALLET_VERIFICATION",
    walletAddress: wallet.address,
    nonceHash: digest(nonce),
    domain: options.domain,
    origin,
    expiresAt
  } });
  return { challengeId, walletId, walletAddress: wallet.address, message, nonce, expiresAt: expiresAt.toISOString() };
}

export async function verifyWalletOwnership(
  database: PrismaClient,
  investorId: string,
  walletId: string,
  body: unknown,
  actor: RegistryActor,
  origin: string,
  now: Date,
  options: AuthRuntimeOptions
) {
  validIdentifiers(investorId, walletId);
  validNow(now);
  const proof = payload(body);
  const challenge = await database.authChallenge.findUnique({ where: { id: proof.challengeId } });
  if (!challenge || challenge.purpose !== "INVESTOR_WALLET_VERIFICATION" || challenge.userId !== actor.id ||
      challenge.walletId !== walletId || challenge.walletAddress.length === 0 || challenge.usedAt !== null ||
      challenge.expiresAt <= now || challenge.domain !== options.domain || challenge.origin !== origin) {
    invalid("INVALID_VERIFICATION", "Wallet verification challenge is invalid or expired", 401);
  }
  const suppliedNonceHash = digest(proof.nonce);
  const storedNonceHash = Buffer.from(challenge.nonceHash);
  if (storedNonceHash.length !== suppliedNonceHash.length || !timingSafeEqual(storedNonceHash, suppliedNonceHash)) {
    invalid("INVALID_VERIFICATION", "Wallet verification challenge is invalid or expired", 401);
  }
  const message = verificationMessage({
    domain: challenge.domain, origin: challenge.origin, investorId, walletId,
    walletAddress: challenge.walletAddress, challengeId: challenge.id, nonce: proof.nonce,
    expiresAt: challenge.expiresAt
  });
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(decodePublicKey(challenge.walletAddress))]),
    format: "der",
    type: "spki"
  });
  if (!verifySignature(null, Buffer.from(message, "utf8"), publicKey, proof.signature)) {
    invalid("INVALID_SIGNATURE", "Wallet signature is invalid", 401);
  }
  try {
    return await database.$transaction(async transaction => {
      const currentChallenge = await transaction.authChallenge.findUnique({ where: { id: challenge.id } });
      if (!currentChallenge || currentChallenge.usedAt !== null || currentChallenge.expiresAt <= now ||
          currentChallenge.userId !== actor.id || currentChallenge.walletId !== walletId) {
        invalid("INVALID_VERIFICATION", "Wallet verification challenge is invalid or expired", 401);
      }
      const wallet = await transaction.wallet.findFirst({
        where: { id: walletId, investorId },
        include: { investor: { select: { status: true } } }
      });
      if (!wallet) invalid("WALLET_NOT_FOUND", "Investor wallet not found", 404);
      if (wallet.investor?.status !== "ACTIVE") invalid("INVESTOR_INACTIVE", "Investor is not active", 409);
      if (wallet.network !== "SOLANA_LOCALNET" || wallet.status !== "PENDING" || wallet.verifiedAt !== null || wallet.revokedAt !== null ||
          wallet.address !== challenge.walletAddress) {
        invalid("WALLET_NOT_PENDING", "Only an unverified pending localnet wallet can be verified", 409);
      }
      const claimed = await transaction.authChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) invalid("INVALID_VERIFICATION", "Wallet verification challenge is invalid or expired", 401);
      const verified = await transaction.wallet.update({
        where: { id: wallet.id }, data: { status: "ACTIVE", verifiedAt: now }, select: walletSelect
      });
      await transaction.auditLog.create({ data: {
        actorId: actor.id,
        actorWallet: actor.walletAddress,
        correlationId: actor.correlationId,
        event: "INVESTOR_WALLET_OWNERSHIP_VERIFIED",
        entityType: "Wallet",
        entityId: wallet.id,
        metadataJson: { investorId, network: wallet.network, status: "ACTIVE", proof: "ed25519-message-signature" }
      } });
      return verified;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    mapDatabaseError(error);
  }
}
