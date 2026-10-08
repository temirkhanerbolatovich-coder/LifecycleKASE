import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { HttpSolanaRpc } from "@lifecycle-kase/solana-client";
import { confirmSnapshotRegistration } from "../apps/api/dist/snapshot-confirmation.js";
import { snapshotHttpOptionsFromEnvironment } from "../apps/api/dist/snapshot-http.js";
import { calculateEntitlements, getEntitlements, reviewEntitlements } from "../apps/api/dist/entitlements.js";
import { confirmCouponFunding, couponNetworkReserve, getCouponBudget, prepareCouponFunding } from "../apps/api/dist/coupon-funding.js";
import { instrumentDeploymentOptions } from "../apps/api/dist/instrument-deployment.js";

// Trusted OS-operator recovery, never an HTTP authentication alternative.
// No .env, key import, session/cookie extraction, signing, broadcast or approval.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const [actionId, operationId, mode] = process.argv.slice(2);
if (!actionId || !operationId || !uuid.test(actionId) || !uuid.test(operationId) ||
    (mode !== undefined && !["prepare-review", "prepare-funding", "confirm-funding"].includes(mode)) || process.argv.length > 5) {
  throw new Error("Usage: confirm-localnet-snapshot.mjs <action UUID> <existing signed snapshot operation UUID> [prepare-review|prepare-funding|confirm-funding]");
}
if (!process.env.LOCALNET_CONFIRM_DATABASE_URL || !process.env.LOCALNET_OPERATOR_WALLET) {
  throw new Error("Explicit LOCALNET_CONFIRM_DATABASE_URL and LOCALNET_OPERATOR_WALLET are required");
}
const databaseUrl = new URL(process.env.LOCALNET_CONFIRM_DATABASE_URL);
const options = snapshotHttpOptionsFromEnvironment(); const rpcUrl = new URL(options.rpcEndpoint);
if (databaseUrl.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname) ||
    !databaseUrl.port || !/^\/lifecycle_kase(_acceptance_[a-z0-9_]+)?$/.test(databaseUrl.pathname) ||
    options.cluster !== "localnet" || rpcUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(rpcUrl.hostname)) {
  throw new Error("Controlled confirmation requires explicit loopback Localnet RPC and development/acceptance PostgreSQL");
}
const database = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
try {
  const operation = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: operationId }, include: {
    corporateAction: { include: { instrument: true, snapshot: true, createdBy: { include: { wallets: true } } } }
  } });
  const action = operation.corporateAction; const actor = action?.createdBy;
  const address = process.env.LOCALNET_OPERATOR_WALLET;
  const preparation = await database.auditLog.findFirst({ where: { blockchainTransactionId: operationId,
    event: "SNAPSHOT_REGISTRATION_PREPARED", actorId: actor?.id ?? randomUUID(), actorWallet: address } });
  if (!action || action.id !== actionId || !actor || actor.role !== "ADMINISTRATOR" ||
      action.instrument.network !== "SOLANA_LOCALNET" || action.instrument.issuerAuthority !== address ||
      operation.operationType !== "REGISTER_SNAPSHOT" || !operation.signature || operation.requiredSigner !== address ||
      !operation.preparedTransactionBase64 || operation.networkGenesisHash !== options.expectedGenesisHash ||
      action.snapshot?.networkGenesisHash !== options.expectedGenesisHash || !preparation ||
      !actor.wallets.some(wallet => wallet.address === address && wallet.network === "SOLANA_LOCALNET" &&
        wallet.status === "ACTIVE" && wallet.verifiedAt !== null && wallet.revokedAt === null)) {
    throw new Error("Recovery requires the existing signed attempt and original authenticated Administrator/issuer preparation audit");
  }
  const result = await confirmSnapshotRegistration(database, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs),
    actionId, operationId, operation.signature, { id: actor.id, walletAddress: address, correlationId: randomUUID(),
      confirmationSource: "CONTROLLED_LOCALNET_CLI" }, options.expectedGenesisHash, new Date());
  if (mode === "prepare-funding" || mode === "confirm-funding") {
    const fundingOptions = { ...instrumentDeploymentOptions({ ...process.env, PROGRAM_ID: process.env.PROGRAM_ID ?? action.instrument.programId }),
      networkReserveLamports: couponNetworkReserve() };
    const rpc = new HttpSolanaRpc(fundingOptions.rpcEndpoint, fundingOptions.rpcTimeoutMs);
    const fundingActor = { id: actor.id, walletAddress: address, correlationId: randomUUID(), operationSource: "CONTROLLED_LOCALNET_CLI" };
    if (mode === "confirm-funding") {
      const funding = await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId,
        operationType: "COUPON_FUNDING", requiredSigner: address, networkGenesisHash: options.expectedGenesisHash,
        status: { in: ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED"] } }, orderBy: { createdAt: "desc" } });
      const fundingAudit = funding && await database.auditLog.findFirst({ where: { blockchainTransactionId: funding.id,
        event: "COUPON_FUNDING_PREPARED", actorId: actor.id, actorWallet: address } });
      if (!funding?.signature || !fundingAudit) throw new Error("Funding confirmation requires the original audited signed funding attempt; it cannot prepare or resend");
      const confirmed = await confirmCouponFunding(database, rpc, actionId,
        { operationId: funding.id, signature: funding.signature }, fundingActor, fundingOptions);
      console.log(JSON.stringify({ actionId, ...confirmed, operationSource: "CONTROLLED_LOCALNET_CLI",
        transactionSubmitted: false, approvalPerformed: false, paymentPerformed: false }));
    } else {
      const budget = await getCouponBudget(database, rpc, actionId, fundingOptions);
      const plan = await prepareCouponFunding(database, rpc, actionId, { version: budget.actionVersion }, fundingActor, fundingOptions);
      console.log(JSON.stringify({ actionId, operationId: plan.operationId, status: plan.status, amountMinor: plan.amountMinor,
        treasuryTokenAccount: plan.treasuryTokenAccount, settlementMint: plan.settlementMint, requiredSigner: plan.requiredSigner,
        networkGenesisHash: plan.networkGenesisHash, resumed: plan.resumed, transactionSubmitted: false, approvalPerformed: false }));
    }
  } else if (mode === "prepare-review") {
    const preparationActor = { id: actor.id, walletAddress: address, correlationId: randomUUID(), operationSource: "CONTROLLED_LOCALNET_CLI" };
    let view = await getEntitlements(database, actionId);
    if (view.status === "SNAPSHOT_CREATED") {
      if (view.investors.some(investor => investor.receiverWallets.length !== 1)) {
        throw new Error("Preparation requires exactly one verified receiver per investor; select ambiguous receivers through the authenticated dashboard");
      }
      view = await calculateEntitlements(database, actionId, { version: view.actionVersion }, preparationActor);
    }
    if (view.status === "CALCULATED") {
      view = await reviewEntitlements(database, actionId, { version: view.actionVersion, decision: "SUBMIT",
        note: "Controlled Localnet preparation: immutable finalized snapshot, integer calculations and receiver choices prepared for explicit owner review." }, preparationActor);
    }
    if (view.status !== "UNDER_REVIEW") throw new Error("Preparation stops at UNDER_REVIEW and cannot approve, reject or return an action");
    console.log(JSON.stringify({ actionId, status: view.status, actionVersion: view.actionVersion,
      totalEntitlementMinor: view.totalEntitlementMinor, eligibleHolders: view.eligibleHolders, items: view.items.map(item => ({
        investorId: item.investorId, balance: item.balanceAtRecordDate, receiver: item.settlementWalletAddress,
        amountMinor: item.amountMinor, tokensToRedeem: item.tokensToRedeem, eligibility: item.currentEligibility })),
      operationSource: "CONTROLLED_LOCALNET_CLI", approvalPerformed: false, transactionSubmitted: false }));
  } else {
    console.log(JSON.stringify({ actionId, ...result, confirmationSource: "CONTROLLED_LOCALNET_CLI", transactionSubmitted: false }));
  }
} finally { await database.$disconnect(); }
