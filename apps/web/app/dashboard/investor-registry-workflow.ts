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
type RegistryCommand = { path: string; body: Record<string, string | number | null> };
export type RegistryProfile = {
  displayName: string; type: string; countryCode: string; externalReference: string | null;
};
export type RegistryProfileDraft = RegistryProfile & { reason: string; expectedVersion: number };
export type RegistryRefreshLock = { kind: "investor" | "wallet"; id: string; version: number };

function validVersion(version: number): boolean {
  return Number.isSafeInteger(version) && version >= 1 && version < 2_147_483_647;
}
function validReason(reason: string): reason is RegistryReviewReason {
  return (REGISTRY_REVIEW_REASONS as readonly string[]).includes(reason);
}
export function canEditInvestorProfile(investor: RegistryInvestorFacts, role: string): boolean {
  return role === "ADMINISTRATOR" && ["ACTIVE", "SUSPENDED"].includes(investor.status ?? "") && validVersion(investor.registryVersion);
}
/** Empty reference input deliberately clears the optional reference; no-op writes stay disabled. */
export function investorProfileCommand(
  investor: RegistryInvestorFacts & RegistryProfile, role: string, draft: RegistryProfileDraft
): RegistryCommand | null {
  if (!canEditInvestorProfile(investor, role) || !validReason(draft.reason) || draft.expectedVersion !== investor.registryVersion) return null;
  if (!/^[A-Za-z]{2}$/.test(draft.countryCode.trim()) || /[\u0000-\u001f\u007f]/.test(draft.displayName) ||
      draft.externalReference !== null && /[\u0000-\u001f\u007f]/.test(draft.externalReference)) return null;
  const profile: RegistryProfile = {
    displayName: draft.displayName.trim(), type: draft.type, countryCode: draft.countryCode.trim().toUpperCase(),
    externalReference: draft.externalReference?.trim() || null
  };
  if (!profile.displayName || profile.displayName.length > 200 || /[\u0000-\u001f\u007f]/.test(profile.displayName) ||
      !["INDIVIDUAL", "INSTITUTIONAL"].includes(profile.type) || !/^[A-Z]{2}$/.test(profile.countryCode) ||
      profile.externalReference !== null && (profile.externalReference.length > 100 || /[\u0000-\u001f\u007f]/.test(profile.externalReference))) return null;
  if (Object.entries(profile).every(([key, value]) => investor[key as keyof RegistryProfile] === value)) return null;
  return { path: `/api/v1/investors/${encodeURIComponent(investor.id)}/profile`,
    body: { ...profile, expectedVersion: draft.expectedVersion, reasonCode: draft.reason } };
}
export function investorRegistryPath(search = "", cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (search.trim()) query.set("search", search.trim());
  if (cursor) query.set("cursor", cursor);
  return `/api/v1/investors?${query}`;
}
export function investorWalletsPath(investorId: string, cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return `/api/v1/investors/${encodeURIComponent(investorId)}/wallets?${query}`;
}
export function mergeRegistryRows<T extends { id: string }>(previous: T[], rows: T[]): T[] {
  const merged = new Map(previous.map(row => [row.id, row]));
  for (const row of rows) merged.set(row.id, row);
  return [...merged.values()];
}
/** A detail refresh reads the selected UUID and restores only wallet pages already opened by the operator. */
export async function readInvestorRegistryDetail<T extends RegistryInvestorFacts & { _count: { wallets: number } }>(
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>,
  id: string, visibleWalletCount: number, signal: AbortSignal
): Promise<{ record: T; nextCursor: string | null }> {
  const canonicalId = id.toLowerCase();
  const raw = await request(`/api/v1/investors/${encodeURIComponent(canonicalId)}`, { signal });
  if (raw["id"] !== canonicalId || !Array.isArray(raw["wallets"]) || !raw["_count"] || typeof raw["_count"] !== "object") throw new Error("Invalid registry response.");
  const record = raw as T;
  let nextCursor = record._count.wallets > record.wallets.length ? record.wallets.at(-1)?.id ?? null : null;
  const visited = new Set<string>();
  while (nextCursor && record.wallets.length < visibleWalletCount && !signal.aborted) {
    if (visited.has(nextCursor)) throw new Error("Invalid registry response.");
    visited.add(nextCursor);
    const page = await request(investorWalletsPath(id, nextCursor), { signal });
    if (!Array.isArray(page["items"])) throw new Error("Invalid registry response.");
    const before = record.wallets.length;
    record.wallets = mergeRegistryRows(record.wallets, page["items"] as T["wallets"]);
    nextCursor = typeof page["nextCursor"] === "string" ? page["nextCursor"] : null;
    if (nextCursor && record.wallets.length <= before) throw new Error("Invalid registry response.");
  }
  return { record, nextCursor };
}
/** Superseded responses cannot change the current search, detail, cursor or loading state. */
export function createRegistryRequestScope() {
  let active: AbortController | null = null;
  return {
    begin() {
      active?.abort();
      const controller = new AbortController(); active = controller;
      return { signal: controller.signal, current: () => active === controller && !controller.signal.aborted };
    },
    cancel() { active?.abort(); active = null; }
  };
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
