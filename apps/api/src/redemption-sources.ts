import { TransactionWorkflowError } from "./transaction-workflow.js";

export type RedemptionTokenSource = { address: string; wallet: string; balanceAtSnapshot: bigint };
type SnapshotInvestor = { id: string; balance: bigint; wallets: { walletAddress: string; tokenAccounts: { address: string; balance: bigint }[] }[] };

/** Preserve every committed snapshot source, including accounts receiving a zero burn allocation. */
export function redemptionTokenSources(investors: readonly SnapshotInvestor[], snapshotInvestorId: string): RedemptionTokenSource[] {
  const investor = investors.find(row => row.id === snapshotInvestorId);
  if (!investor) throw new TransactionWorkflowError("SNAPSHOT_INTEGRITY", "Redemption snapshot investor is missing");
  const sources = investor.wallets.flatMap(wallet => wallet.tokenAccounts.map(account => ({
    address: account.address, wallet: wallet.walletAddress, balanceAtSnapshot: account.balance
  }))).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  if (sources.length === 0 || sources.length > 8 || new Set(sources.map(row => row.address)).size !== sources.length ||
      sources.some(row => row.balanceAtSnapshot <= 0n) || sources.reduce((sum, row) => sum + row.balanceAtSnapshot, 0n) !== investor.balance) {
    throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Redemption requires one to eight unique committed token accounts covering the investor balance");
  }
  return sources;
}

/** The program uses this exact ascending-account greedy allocation, independently of current balances. */
export function redemptionBurnAllocation(sources: readonly RedemptionTokenSource[], tokensToRedeem: bigint) {
  if (tokensToRedeem <= 0n || tokensToRedeem > sources.reduce((sum, row) => sum + row.balanceAtSnapshot, 0n)) {
    throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Burn amount exceeds committed source balances");
  }
  let remaining = tokensToRedeem;
  return sources.map(source => {
    const burnAmount = source.balanceAtSnapshot < remaining ? source.balanceAtSnapshot : remaining;
    remaining -= burnAmount;
    return { ...source, burnAmount };
  });
}

export function requireRedemptionSupply(snapshotSupply: bigint, tokensAlreadyRedeemed: bigint, currentSupply: bigint, tokensToRedeem = 0n) {
  if (tokensAlreadyRedeemed < 0n || tokensToRedeem < 0n || tokensAlreadyRedeemed + tokensToRedeem > snapshotSupply ||
      currentSupply !== snapshotSupply - tokensAlreadyRedeemed) {
    throw new TransactionWorkflowError("REDEMPTION_SUPPLY_CHANGED", "Another action or external burn changed the committed mint supply");
  }
  return currentSupply - tokensToRedeem;
}

export function redemptionRetiresInstrument(type: "EARLY_REDEMPTION" | "BOND_REDEMPTION" | "COUPON_PAYMENT", finalSupply: bigint) {
  if (type === "COUPON_PAYMENT" || finalSupply < 0n || type === "BOND_REDEMPTION" && finalSupply !== 0n) {
    throw new TransactionWorkflowError("REDEMPTION_SUPPLY_CHANGED", "Maturity redemption must retire the entire captured supply");
  }
  return finalSupply === 0n;
}
