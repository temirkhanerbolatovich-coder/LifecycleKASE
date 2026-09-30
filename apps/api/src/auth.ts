import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";

import type { PrismaClient, UserRole } from "@prisma/client";
import { decodePublicKey } from "@lifecycle-kase/solana-client";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const OPERATOR_ROLES = new Set<UserRole>([
  "ADMINISTRATOR",
  "ISSUER_OPERATOR",
  "COMPLIANCE_OFFICER",
  "APPROVER",
  "AUDITOR"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUTH_COOKIE_NAME = "lifecyclekase_session";

export class AuthFlowError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AuthFlowError";
  }
}

export type AuthRuntimeOptions = {
  domain: string;
  allowedOrigins: readonly string[];
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
};

function positiveSeconds(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AuthFlowError("AUTH_CONFIGURATION_INVALID", `${name} must be a positive integer`, 503);
  }
  return parsed;
}

export function authOptionsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): AuthRuntimeOptions {
  const domain = environment.AUTH_DOMAIN?.trim() || "localhost";
  if (domain.length > 255 || !/^[a-z0-9.-]+(?::\d+)?$/i.test(domain)) {
    throw new AuthFlowError("AUTH_CONFIGURATION_INVALID", "AUTH_DOMAIN is invalid", 503);
  }
  const allowedOrigins = (environment.AUTH_ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !isHttpOrigin(origin))) {
    throw new AuthFlowError("AUTH_CONFIGURATION_INVALID", "AUTH_ALLOWED_ORIGINS is invalid", 503);
  }
  return {
    domain,
    allowedOrigins,
    challengeTtlSeconds: positiveSeconds(environment.AUTH_CHALLENGE_TTL_SECONDS, 300, "AUTH_CHALLENGE_TTL_SECONDS"),
    sessionTtlSeconds: positiveSeconds(environment.AUTH_SESSION_TTL_SECONDS, 3600, "AUTH_SESSION_TTL_SECONDS")
  };
}

export function requireAuthenticationEnabled(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.AUTH_ENABLED !== "true") {
    throw new AuthFlowError("AUTH_NOT_CONFIGURED", "Operator authentication is not configured", 503);
  }
}

function isHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === value;
  } catch {
    return false;
  }
}

function requireAllowedOrigin(origin: string | undefined, options: AuthRuntimeOptions): string {
  if (!origin || !options.allowedOrigins.includes(origin)) {
    throw new AuthFlowError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed", 403);
  }
  return origin;
}

function requireWalletAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthFlowError("INVALID_WALLET_ADDRESS", "Wallet address is invalid", 400);
  }
  try {
    decodePublicKey(value);
    return value;
  } catch {
    throw new AuthFlowError("INVALID_WALLET_ADDRESS", "Wallet address is invalid", 400);
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authenticationMessage(input: {
  domain: string;
  origin: string;
  walletAddress: string;
  challengeId: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    "LifecycleKASE operator authentication",
    `Domain: ${input.domain}`,
    `Origin: ${input.origin}`,
    `Wallet: ${input.walletAddress}`,
    `Challenge ID: ${input.challengeId}`,
    `Nonce: ${input.nonce}`,
    `Expires At: ${input.expiresAt.toISOString()}`,
    "This request does not submit a transaction or authorize a payment."
  ].join("\n");
}

function validNow(now: Date): void {
  if (!Number.isFinite(now.getTime())) {
    throw new AuthFlowError("INVALID_TIME", "Authentication time is invalid", 500);
  }
}

export async function createOperatorChallenge(
  database: PrismaClient,
  input: { walletAddress: unknown; origin: string | undefined; now: Date },
  options: AuthRuntimeOptions
) {
  validNow(input.now);
  const origin = requireAllowedOrigin(input.origin, options);
  const walletAddress = requireWalletAddress(input.walletAddress);
  const wallet = await database.wallet.findUnique({
    where: { address: walletAddress },
    include: { user: true }
  });
  if (!wallet?.user || wallet.status !== "ACTIVE" || wallet.verifiedAt === null ||
      wallet.revokedAt !== null || !OPERATOR_ROLES.has(wallet.user.role)) {
    throw new AuthFlowError("UNAUTHORIZED_WALLET", "Wallet is not authorized for operator access", 403);
  }

  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + options.challengeTtlSeconds * 1000);
  const message = authenticationMessage({
    domain: options.domain, origin, walletAddress, challengeId, nonce, expiresAt
  });
  await database.authChallenge.create({
    data: {
      id: challengeId,
      userId: wallet.user.id,
      walletAddress,
      nonceHash: digest(nonce),
      domain: options.domain,
      origin,
      expiresAt
    }
  });
  return { challengeId, walletAddress, message, nonce, expiresAt: expiresAt.toISOString() };
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length < 80 || value.length > 100) {
    throw new AuthFlowError("INVALID_SIGNATURE", "Wallet signature is invalid", 401);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new AuthFlowError("INVALID_SIGNATURE", "Wallet signature is invalid", 401);
  }
  return decoded;
}

export async function verifyOperatorChallenge(
  database: PrismaClient,
  input: {
    challengeId: unknown;
    nonce: unknown;
    signature: unknown;
    origin: string | undefined;
    now: Date;
  },
  options: AuthRuntimeOptions
) {
  validNow(input.now);
  const origin = requireAllowedOrigin(input.origin, options);
  if (typeof input.challengeId !== "string" || !UUID_PATTERN.test(input.challengeId) ||
      typeof input.nonce !== "string" || input.nonce.length < 40 || input.nonce.length > 64) {
    throw new AuthFlowError("INVALID_CHALLENGE", "Authentication challenge is invalid", 401);
  }
  const signature = decodeCanonicalBase64(input.signature);
  const challenge = await database.authChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || !challenge.userId || challenge.usedAt !== null || challenge.expiresAt <= input.now ||
      challenge.domain !== options.domain || challenge.origin !== origin) {
    throw new AuthFlowError("INVALID_CHALLENGE", "Authentication challenge is invalid or expired", 401);
  }
  const suppliedNonceHash = digest(input.nonce);
  const storedNonceHash = Buffer.from(challenge.nonceHash);
  if (storedNonceHash.length !== suppliedNonceHash.length ||
      !timingSafeEqual(storedNonceHash, suppliedNonceHash)) {
    throw new AuthFlowError("INVALID_CHALLENGE", "Authentication challenge is invalid or expired", 401);
  }
  const message = authenticationMessage({
    domain: challenge.domain,
    origin: challenge.origin,
    walletAddress: challenge.walletAddress,
    challengeId: challenge.id,
    nonce: input.nonce,
    expiresAt: challenge.expiresAt
  });
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(decodePublicKey(challenge.walletAddress))]),
    format: "der",
    type: "spki"
  });
  if (!verifySignature(null, Buffer.from(message, "utf8"), publicKey, signature)) {
    throw new AuthFlowError("INVALID_SIGNATURE", "Wallet signature is invalid", 401);
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + options.sessionTtlSeconds * 1000);
  const result = await database.$transaction(async (transaction) => {
    const wallet = await transaction.wallet.findUnique({
      where: { address: challenge.walletAddress },
      include: { user: true }
    });
    if (!wallet?.user || wallet.user.id !== challenge.userId || wallet.status !== "ACTIVE" ||
        wallet.verifiedAt === null || wallet.revokedAt !== null || !OPERATOR_ROLES.has(wallet.user.role)) {
      throw new AuthFlowError("UNAUTHORIZED_WALLET", "Wallet is not authorized for operator access", 403);
    }
    const claimed = await transaction.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: input.now } },
      data: { usedAt: input.now }
    });
    if (claimed.count !== 1) {
      throw new AuthFlowError("INVALID_CHALLENGE", "Authentication challenge is invalid or expired", 401);
    }
    const session = await transaction.session.create({
      data: { userId: wallet.user.id, tokenHash: digest(sessionToken), expiresAt },
      select: { id: true }
    });
    return { sessionId: session.id, user: wallet.user };
  });
  return {
    sessionToken,
    sessionId: result.sessionId,
    expiresAt: expiresAt.toISOString(),
    user: { id: result.user.id, displayName: result.user.displayName, role: result.user.role }
  };
}

export async function readOperatorSession(database: PrismaClient, token: string | undefined, now: Date) {
  validNow(now);
  if (!token || token.length < 40 || token.length > 64) {
    throw new AuthFlowError("SESSION_REQUIRED", "An active operator session is required", 401);
  }
  const session = await database.session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: true }
  });
  if (!session || session.revokedAt !== null || session.expiresAt <= now ||
      !OPERATOR_ROLES.has(session.user.role)) {
    throw new AuthFlowError("SESSION_INVALID", "Operator session is invalid or expired", 401);
  }
  return {
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
    user: { id: session.user.id, displayName: session.user.displayName, role: session.user.role }
  };
}

export async function revokeOperatorSession(database: PrismaClient, token: string | undefined, now: Date): Promise<void> {
  validNow(now);
  if (!token) return;
  await database.session.updateMany({
    where: { tokenHash: digest(token), revokedAt: null },
    data: { revokedAt: now }
  });
}
