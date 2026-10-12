import { encodeBase58, isActionId } from "./snapshot-workflow";
import { validatedExactRedemptionSummary, type EntitlementsView } from "./entitlement-workflow";
import { redemptionAllocationMatches } from "./action-workflow";
import { requireOnchainCalculationIdentity, type PreparedOnchainCalculation } from "./onchain-entitlement-workflow";
import { requireReviewedTransaction, transactionHex } from "./reviewed-transaction";
import { controlledHoldingAddress } from "./controlled-identity";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const key = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
function publicKey(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let number = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char); if (digit < 0) throw new Error("Invalid public key"); number = number * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) { bytes[index] = Number(number & 255n); number >>= 8n; }
  if (number !== 0n || encodeBase58(bytes) !== value) throw new Error("Invalid public key"); return bytes;
}
function u64(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n) throw new Error("Invalid u64");
  const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true); return transactionHex(bytes);
}
function hexBytes(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid bytes");
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
}
async function discriminator(name: string) {
  return transactionHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`)))).slice(0, 16);
}

/** The committed redemption sources must match the independently loaded immutable snapshot before any signing request. */
export async function requireRedemptionCalculationTransaction(plan: PreparedOnchainCalculation, view: EntitlementsView): Promise<void> {
  if (!["EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(view.actionType ?? "")) return;
  const fail = () => new Error("Регистрация погашения не совпадает со snapshot, источниками токенов или PDA. Подпись остановлена.");
  const exact = view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2";
  const controlled = view.tokenPolicy === "CONTROLLED_FROZEN_V2";
  if (controlled ? plan.tokenPolicy !== view.tokenPolicy : plan.tokenPolicy !== undefined && plan.tokenPolicy !== "LEGACY_UNRESTRICTED_V1") throw fail();
  if (!key(view.tokenMint) || !key(plan.redemptionProgressAddress) || !redemptionAllocationMatches(plan as unknown as Record<string, unknown>, view) ||
      exact && (view.actionType !== "EARLY_REDEMPTION" || plan.phase !== "RESET" && !key(plan.targetAddress))) throw fail();
  if (exact && !validatedExactRedemptionSummary(view)) throw fail();
  await requireOnchainCalculationIdentity(plan, view);
  const expected = [
    { program: COMPUTE, accounts: [] as string[], data: "02801a0600" },
    { program: COMPUTE, accounts: [] as string[], data: "030000000000000000" }
  ];
  const writable = new Set([plan.requiredSigner, plan.actionAddress]);
  if (plan.phase === "REGISTER" || plan.phase === "RESERVE_UNITS") {
    const row = view.items.find(item => item.id === plan.entitlementId);
    const sources = row?.redemptionSources;
    if (!row || !sources?.length || sources.length > 8 || !isActionId(row.investorId) || plan.bondMint !== view.tokenMint ||
        !key(plan.redemptionSourcesAddress) || !key(plan.entitlementAddress) ||
        !plan.tokenAccounts || plan.tokenAccounts.length !== sources.length || sources.some((source, index) =>
          ["address", "walletAddress", "balanceAtSnapshot"].some(field => source[field as keyof typeof source] !== plan.tokenAccounts![index]?.[field as keyof typeof source])) ||
        new Set(sources.map(source => source.address)).size !== sources.length ||
        sources.some((source, index) => !key(source.address) || !key(source.walletAddress) || !/^[1-9][0-9]*$/.test(source.balanceAtSnapshot) ||
          index > 0 && source.address <= sources[index - 1]!.address) ||
        sources.reduce((sum, source) => sum + BigInt(source.balanceAtSnapshot), 0n) !== BigInt(row.balanceAtRecordDate)) throw fail();
    const count = new Uint8Array(4); new DataView(count.buffer).setUint32(0, sources.length, true);
    const sourceData = transactionHex(count) + sources.map(source => transactionHex(publicKey(source.address)) +
      transactionHex(publicKey(source.walletAddress)) + u64(source.balanceAtSnapshot)).join("");
    const commitment = new Uint8Array([...new TextEncoder().encode("LifecycleKASE:RedemptionSources:v1"),
      ...publicKey(plan.actionAddress), ...publicKey(plan.entitlementAddress!), ...hexBytes(plan.snapshotHash), ...hexBytes(sourceData)]);
    const sourceHash = transactionHex(new Uint8Array(await crypto.subtle.digest("SHA-256", commitment)));
    if (plan.sourceHash !== sourceHash) throw fail();
    if (plan.phase === "REGISTER") {
      expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress, ...(exact ? [plan.targetAddress!] : []), plan.entitlementAddress!, SYSTEM],
      data: await discriminator(exact ? "register_entitlement_v2" : "register_entitlement") + row.investorId.replace(/-/g, "") + plan.snapshotHash +
        transactionHex(publicKey(row.settlementWalletAddress)) + u64(row.balanceAtRecordDate) + "01" + u64(row.amountMinor) + u64(row.tokensToRedeem) });
    expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress, plan.entitlementAddress!,
      plan.redemptionSourcesAddress!, plan.redemptionProgressAddress!, view.tokenMint!, TOKEN, SYSTEM, ...sources.map(source => source.address),
      ...(controlled ? [plan.controlledPolicyAddress!, plan.controlledCaptureAddress!] : [])],
      data: await discriminator(controlled ? "register_controlled_redemption_sources" : "register_redemption_sources") + sourceData });
    for (const value of [plan.entitlementAddress!, plan.redemptionSourcesAddress!, plan.redemptionProgressAddress!]) writable.add(value);
    } else {
      const holdings = await Promise.all(sources.map(source => controlledHoldingAddress(plan.programId, plan.instrumentAddress, source.address)));
      let remaining = BigInt(row.tokensToRedeem);
      const allocations = sources.map(source => { const amount = BigInt(source.balanceAtSnapshot) < remaining ? BigInt(source.balanceAtSnapshot) : remaining; remaining -= amount; return amount.toString(); });
      if (!controlled || remaining !== 0n || JSON.stringify(plan.allocations) !== JSON.stringify(allocations) || JSON.stringify(plan.holdingAddresses) !== JSON.stringify(holdings)) throw fail();
      expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress, plan.controlledPolicyAddress!, plan.controlledCaptureAddress!, plan.entitlementAddress!,
        plan.redemptionSourcesAddress!, plan.redemptionProgressAddress!, plan.unitReservationAddress!, view.tokenMint!, TOKEN, SYSTEM, ...sources.map(source => source.address), ...holdings],
        data: await discriminator("reserve_controlled_redemption") });
      writable.delete(plan.actionAddress); writable.add(plan.controlledCaptureAddress!); writable.add(plan.unitReservationAddress!); holdings.forEach(value => writable.add(value));
    }
  } else {
    const rows = plan.phase === "FINALIZE" ? view.items : view.items.filter(item => item.onchainPda);
    if (!plan.sourceAddresses || plan.sourceAddresses.length !== rows.length || plan.sourceAddresses.some(value => !key(value)) ||
        new Set(plan.sourceAddresses).size !== plan.sourceAddresses.length) throw fail();
    expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress, ...(exact && plan.phase === "FINALIZE" ? [plan.targetAddress!] : []), plan.redemptionProgressAddress!,
      ...rows.flatMap((row, index) => [row.onchainPda!, plan.sourceAddresses![index]!])],
      data: await discriminator(plan.phase === "FINALIZE" ? exact ? "finalize_calculation_v2" : "finalize_calculation" : "reset_calculation") });
    if (plan.phase === "RESET") for (const value of [plan.redemptionProgressAddress!, ...rows.map(row => row.onchainPda!), ...plan.sourceAddresses]) writable.add(value);
  }
  requireReviewedTransaction(plan.serializedTransactionBase64, plan.requiredSigner, expected, writable, fail);
}
