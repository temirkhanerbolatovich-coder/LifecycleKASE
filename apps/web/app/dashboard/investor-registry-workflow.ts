export const REGISTRY_REVIEW_REASONS = [
  "REGISTRY_CORRECTION", "PERIODIC_REVIEW", "SECURITY_CONCERN", "OWNER_REQUEST"
] as const;
export type RegistryReviewReason = typeof REGISTRY_REVIEW_REASONS[number];
export type EligibilityDecision = "ELIGIBLE" | "NOT_ELIGIBLE" | "SUSPENDED";
type WalletStatus = "ACTIVE" | "BLOCKED";
export type RegistryInvestorFacts = {
  id: string; status?: string; eligibilityStatus: string; registryVersion: number;
  wallets: RegistryWalletFacts[];
};
export type RegistryWalletFacts = {
  id: string; status: string; registryVersion: number; verifiedAt: string | null; revokedAt: string | null;
};
type RegistryCommand = { path: string; body: Record<string, string | number> };
export type RegistryRefreshLock = { kind: "investor" | "wallet"; id: string; version: number };

function validVersion(version: number): boolean {
  return Number.isSafeInteger(version) && version >= 1 && version < 2_147_483_647;
}
function validReason(reason: string): reason is RegistryReviewReason {
  return (REGISTRY_REVIEW_REASONS as readonly string[]).includes(reason);
}
export function hasActiveVerifiedWallet(investor: RegistryInvestorFacts): boolean {
  return investor.wallets.some(wallet => wallet.status === "ACTIVE" && Boolean(wallet.verifiedAt) && wallet.revokedAt === null);
}
export function canReviewEligibility(investor: RegistryInvestorFacts, role: string): boolean {
  return role === "ADMINISTRATOR" && investor.status === "ACTIVE" && validVersion(investor.registryVersion) &&
    ["ELIGIBLE", "NOT_ELIGIBLE", "SUSPENDED"].includes(investor.eligibilityStatus);
}
export function eligibilityReviewCommand(
  investor: RegistryInvestorFacts, role: string, decision: string, reason: string
): RegistryCommand | null {
  if (!canReviewEligibility(investor, role) || !validReason(reason) ||
      !["ELIGIBLE", "NOT_ELIGIBLE", "SUSPENDED"].includes(decision) || decision === investor.eligibilityStatus ||
      (decision === "ELIGIBLE" && !hasActiveVerifiedWallet(investor))) return null;
  return {
    path: `/api/v1/investors/${encodeURIComponent(investor.id)}/eligibility/review`,
    body: { decision, expectedVersion: investor.registryVersion, reasonCode: reason }
  };
}
export function canChangeWalletStatus(investor: RegistryInvestorFacts, wallet: RegistryWalletFacts, role: string): boolean {
  return role === "ADMINISTRATOR" && investor.status === "ACTIVE" && investor.wallets.some(row => row.id === wallet.id) &&
    validVersion(wallet.registryVersion) && ["ACTIVE", "BLOCKED"].includes(wallet.status) &&
    Boolean(wallet.verifiedAt) && wallet.revokedAt === null;
}
export function walletStatusCommand(
  investor: RegistryInvestorFacts, wallet: RegistryWalletFacts, role: string, reason: string
): RegistryCommand | null {
  if (!canChangeWalletStatus(investor, wallet, role) || !validReason(reason)) return null;
  const status: WalletStatus = wallet.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
  return {
    path: `/api/v1/investors/${encodeURIComponent(investor.id)}/wallets/${encodeURIComponent(wallet.id)}/status`,
    body: { status, expectedVersion: wallet.registryVersion, reasonCode: reason }
  };
}

/** Only a newer read of the affected record unlocks a successfully saved change. */
export function remainingRegistryRefreshLocks(locks: RegistryRefreshLock[], investors: RegistryInvestorFacts[]): RegistryRefreshLock[] {
  return locks.filter(lock => {
    const record = lock.kind === "investor"
      ? investors.find(investor => investor.id === lock.id)
      : investors.flatMap(investor => investor.wallets).find(wallet => wallet.id === lock.id);
    return !record || !Number.isSafeInteger(record.registryVersion) || record.registryVersion > 2_147_483_647 ||
      record.registryVersion <= lock.version;
  });
}

/** A failed follow-up read is distinct from a rejected write and never replays the POST. */
export async function saveRegistryChange(
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>,
  command: RegistryCommand,
  saved: () => void,
  refresh: () => Promise<unknown>
): Promise<{ refreshed: boolean }> {
  await request(command.path, { method: "POST", body: JSON.stringify(command.body) });
  saved();
  try { await refresh(); return { refreshed: true }; }
  catch { return { refreshed: false }; }
}
