import { randomUUID } from "node:crypto";

import type { PrismaClient, UserRole } from "@prisma/client";
import { decodePublicKey } from "@lifecycle-kase/solana-client";

const OPERATOR_ROLES = new Set<UserRole>([
  "ADMINISTRATOR",
  "ISSUER_OPERATOR",
  "COMPLIANCE_OFFICER",
  "APPROVER",
  "AUDITOR"
]);
const WALLET_NETWORKS = new Set(["SOLANA_DEVNET", "SOLANA_LOCALNET"]);

export class OperatorProvisioningError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OperatorProvisioningError";
  }
}

export type OperatorProvisioningInput = {
  walletAddress: string;
  displayName: string;
  normalizedEmail?: string;
  role: UserRole;
  network: string;
  now: Date;
  correlationId?: string;
};

function normalizedInput(input: OperatorProvisioningInput): OperatorProvisioningInput & { correlationId: string } {
  const walletAddress = input.walletAddress.trim();
  try {
    decodePublicKey(walletAddress);
  } catch {
    throw new OperatorProvisioningError("INVALID_WALLET_ADDRESS", "Wallet address is not a Solana public key");
  }
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 200) {
    throw new OperatorProvisioningError("INVALID_DISPLAY_NAME", "Display name must contain 1 to 200 characters");
  }
  if (!OPERATOR_ROLES.has(input.role)) {
    throw new OperatorProvisioningError("INVALID_OPERATOR_ROLE", "Role is not allowed for an operator");
  }
  if (!WALLET_NETWORKS.has(input.network)) {
    throw new OperatorProvisioningError("INVALID_WALLET_NETWORK", "Wallet network must be SOLANA_DEVNET or SOLANA_LOCALNET");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new OperatorProvisioningError("INVALID_TIME", "Provisioning time is invalid");
  }
  const normalizedEmail = input.normalizedEmail?.trim().toLowerCase();
  if (normalizedEmail !== undefined &&
      (normalizedEmail.length < 3 || normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(normalizedEmail))) {
    throw new OperatorProvisioningError("INVALID_EMAIL", "Operator email is invalid");
  }
  return {
    walletAddress,
    displayName,
    ...(normalizedEmail === undefined ? {} : { normalizedEmail }),
    role: input.role,
    network: input.network,
    now: input.now,
    correlationId: input.correlationId ?? randomUUID()
  };
}

export async function provisionOperator(database: PrismaClient, rawInput: OperatorProvisioningInput) {
  const input = normalizedInput(rawInput);
  return database.$transaction(async (transaction) => {
    const existingWallet = await transaction.wallet.findUnique({
      where: { address: input.walletAddress },
      include: { user: true }
    });
    if (existingWallet) {
      const emailMatches = input.normalizedEmail === undefined ||
        existingWallet.user?.normalizedEmail === input.normalizedEmail;
      const isExactOperator = existingWallet.investorId === null &&
        existingWallet.user !== null &&
        existingWallet.user.role === input.role &&
        existingWallet.user.displayName === input.displayName &&
        emailMatches &&
        existingWallet.network === input.network &&
        existingWallet.status === "ACTIVE" &&
        existingWallet.verifiedAt !== null &&
        existingWallet.revokedAt === null;
      if (!isExactOperator) {
        throw new OperatorProvisioningError(
          "WALLET_CONFLICT",
          "Wallet already exists with different ownership, role, identity, network, or lifecycle state"
        );
      }
      return {
        created: false,
        userId: existingWallet.user!.id,
        walletId: existingWallet.id,
        walletAddress: existingWallet.address,
        role: existingWallet.user!.role,
        network: existingWallet.network
      };
    }

    if (input.normalizedEmail !== undefined) {
      const existingUser = await transaction.user.findUnique({
        where: { normalizedEmail: input.normalizedEmail },
        select: { id: true }
      });
      if (existingUser) {
        throw new OperatorProvisioningError(
          "EMAIL_CONFLICT",
          "Email already belongs to another user; use a reviewed administration flow to attach another wallet"
        );
      }
    }

    const user = await transaction.user.create({
      data: {
        displayName: input.displayName,
        ...(input.normalizedEmail === undefined ? {} : { normalizedEmail: input.normalizedEmail }),
        role: input.role
      },
      select: { id: true, role: true }
    });
    const wallet = await transaction.wallet.create({
      data: {
        address: input.walletAddress,
        userId: user.id,
        network: input.network,
        status: "ACTIVE",
        verifiedAt: input.now
      },
      select: { id: true, address: true, network: true }
    });
    await transaction.auditLog.create({
      data: {
        event: "OPERATOR_PROVISIONED",
        entityType: "User",
        entityId: user.id,
        correlationId: input.correlationId,
        metadataJson: {
          walletAddress: wallet.address,
          walletNetwork: wallet.network,
          role: user.role,
          source: "controlled-cli"
        }
      }
    });
    return {
      created: true,
      userId: user.id,
      walletId: wallet.id,
      walletAddress: wallet.address,
      role: user.role,
      network: wallet.network
    };
  }, { isolationLevel: "Serializable" });
}
