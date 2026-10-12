import { unsignedTransactionForSigner, type SupportedSnapshotCluster } from "./snapshot-workflow";
import { requireReviewedTransaction, transactionHex, type ReviewedInstruction } from "./reviewed-transaction";
import { ASSOCIATED_PROGRAM, associatedAddress, controlledHoldingAddress, controlledInstrumentAddresses, derivedAddress,
  COMPUTE_PROGRAM, instructionDiscriminator, keyHex, publicKeyBytes, seededMintAddress, SYSTEM_PROGRAM, TOKEN_PROGRAM, unsignedHex, uuidBytes,
  type InstrumentTokenPolicy } from "./controlled-identity";

export type DeploymentInstrument = {
  id: string; issuerAuthority: string; complianceAuthority?: string; corporateActionAuthority?: string;
  tokenPolicy?: InstrumentTokenPolicy; programId: string | null; network: string; networkGenesisHash?: string | null;
  faceValueMinor: string; couponRateBps: number; paymentsPerYear: number; issueAt: string; maturityAt: string; totalSupply: string;
  mintAddress: string | null;
};
export type DeploymentPhase = "MINT_SETUP" | "DISTRIBUTION" | "INITIALIZE" | "ACTIVATE";
export type DistributionAllocation = { investorId: string; walletAddress: string; tokenAccount: string; amount: string };
export type DeploymentPlan = { operationId: string; phase: DeploymentPhase; cluster: SupportedSnapshotCluster;
  requiredSigner: string; networkGenesisHash: string; serializedTransactionBase64: string; tokenPolicy?: InstrumentTokenPolicy;
  bondMint?: string; settlementMint?: string; treasuryTokenAccount?: string; instrumentAddress?: string;
  allocations?: DistributionAllocation[]; rent?: { bondRentLamports: string; settlementRentLamports: string } };
export type ControlledDeploymentConfiguration = { programId: string; networkGenesisHash: string };

/** Derive every governed issuance instruction independently of the prepared transaction and its PDA metadata. */
export async function reviewedDeploymentPlan(payload: Record<string, unknown>, instrument: DeploymentInstrument, wallet: string,
  configured: ControlledDeploymentConfiguration | null, selectedAllocations?: readonly { walletAddress: string; amount: string }[]): Promise<DeploymentPlan> {
  const invalid = () => new Error("План выпуска отличается от выбранного инструмента, сети или распределения. Подпись остановлена.");
  const plan = payload as unknown as DeploymentPlan;
  if (!["MINT_SETUP", "DISTRIBUTION", "INITIALIZE", "ACTIVATE"].includes(String(payload["phase"])) ||
      !["localnet", "devnet"].includes(String(payload["cluster"])) || payload["requiredSigner"] !== wallet || instrument.issuerAuthority !== wallet ||
      typeof payload["operationId"] !== "string" || typeof payload["serializedTransactionBase64"] !== "string") throw invalid();
  unsignedTransactionForSigner(plan.serializedTransactionBase64, wallet);
  const controlled = instrument.tokenPolicy === "CONTROLLED_FROZEN_V2";
  if (!controlled) {
    if (payload["tokenPolicy"] !== undefined && payload["tokenPolicy"] !== "LEGACY_UNRESTRICTED_V1") throw invalid();
    if (["DISTRIBUTION", "ACTIVATE"].includes(plan.phase) && plan.allocations?.length !== 3 ||
        ["INITIALIZE", "ACTIVATE"].includes(plan.phase) && typeof plan.instrumentAddress !== "string") throw invalid();
    return plan;
  }
  if (!configured || payload["tokenPolicy"] !== instrument.tokenPolicy || payload["programId"] !== configured.programId ||
      payload["instrumentId"] !== instrument.id || payload["networkGenesisHash"] !== configured.networkGenesisHash ||
      instrument.programId !== null && instrument.programId !== configured.programId ||
      instrument.network !== (plan.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET") ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64") throw invalid();
  const terms = payload["terms"] as Record<string, unknown> | undefined;
  if (!terms || ["issuerAuthority", "complianceAuthority", "corporateActionAuthority", "faceValueMinor", "couponRateBps", "paymentsPerYear", "issueAt", "maturityAt", "totalSupply"]
    .some(field => terms[field] !== instrument[field as keyof DeploymentInstrument])) throw invalid();
  const { instrumentAddress, instrumentAuthority, controlledPolicyAddress } = await controlledInstrumentAddresses(configured.programId, instrument.id);
  if (plan.instrumentAddress !== instrumentAddress || payload["controlledPolicyAddress"] !== controlledPolicyAddress) throw invalid();
  const encodedId = btoa(String.fromCharCode(...uuidBytes(instrument.id))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const bondSeed = `lk-v2b-${encodedId}`; const settlementSeed = `lk-v2s-${encodedId}`;
  const bondMint = await seededMintAddress(wallet, bondSeed); const settlementMint = await seededMintAddress(wallet, settlementSeed);
  const treasury = await associatedAddress(wallet, bondMint);
  if (plan.bondMint !== bondMint || plan.settlementMint !== settlementMint || plan.treasuryTokenAccount !== treasury ||
      instrument.mintAddress !== null && instrument.mintAddress !== bondMint) throw invalid();
  const expected: ReviewedInstruction[] = [{ program: COMPUTE_PROGRAM, accounts: [], data: "02801a0600" },
    { program: COMPUTE_PROGRAM, accounts: [], data: "030000000000000000" }]; const writable = new Set([wallet]);
  const add = (program: string, accounts: string[], data: string, modified: string[] = []) => {
    expected.push({ program, accounts, data }); modified.forEach(value => writable.add(value));
  };
  const ata = (owner: string, tokenAccount: string) => add(ASSOCIATED_PROGRAM, [wallet, tokenAccount, owner, bondMint, SYSTEM_PROGRAM, TOKEN_PROGRAM], "01", [tokenAccount]);
  const holding = async (tokenAccount: string) => {
    const holdingAddress = await controlledHoldingAddress(configured.programId, instrumentAddress, tokenAccount);
    add(configured.programId, [wallet, instrumentAddress, controlledPolicyAddress, holdingAddress, tokenAccount, TOKEN_PROGRAM, SYSTEM_PROGRAM],
      await instructionDiscriminator("register_controlled_holding"), [holdingAddress]); return holdingAddress;
  };
  if (plan.phase === "MINT_SETUP") {
    const rent = plan.rent; if (!rent || !/^[1-9][0-9]*$/.test(rent.bondRentLamports) || !/^[1-9][0-9]*$/.test(rent.settlementRentLamports)) throw invalid();
    const createMint = (mint: string, seed: string, amount: string, size: number) => add(SYSTEM_PROGRAM, [wallet, mint],
      "03000000" + keyHex(wallet) + unsignedHex(seed.length) + transactionHex(new TextEncoder().encode(seed)) + unsignedHex(amount) + unsignedHex(size) + keyHex(TOKEN_PROGRAM), [mint]);
    const rentSysvar = "SysvarRent111111111111111111111111111111111";
    createMint(bondMint, bondSeed, rent.bondRentLamports, 207);
    add(TOKEN_PROGRAM, [bondMint], "23" + keyHex(instrumentAuthority));
    add(TOKEN_PROGRAM, [bondMint], "1c0002");
    add(TOKEN_PROGRAM, [bondMint, rentSysvar], "0000" + keyHex(wallet) + "01" + keyHex(instrumentAuthority));
    createMint(settlementMint, settlementSeed, rent.settlementRentLamports, 82);
    add(TOKEN_PROGRAM, [settlementMint, rentSysvar], "0006" + keyHex(wallet) + "00");
    ata(wallet, treasury);
  } else if (plan.phase === "INITIALIZE") {
    const programData = await derivedAddress("BPFLoaderUpgradeab1e11111111111111111111111", [publicKeyBytes(configured.programId)]);
    const unix = (value: string) => { const number = Date.parse(value) / 1000; if (!Number.isSafeInteger(number) || number < 0) throw invalid(); return unsignedHex(number); };
    add(configured.programId, [wallet, configured.programId, programData, instrumentAddress, instrumentAuthority, controlledPolicyAddress, bondMint, settlementMint, treasury, TOKEN_PROGRAM, SYSTEM_PROGRAM],
      await instructionDiscriminator("initialize_controlled_instrument") + transactionHex(uuidBytes(instrument.id)) + keyHex(instrument.complianceAuthority!) + keyHex(instrument.corporateActionAuthority!) +
      unsignedHex(instrument.faceValueMinor) + unsignedHex(instrument.couponRateBps, 4) + unsignedHex(instrument.paymentsPerYear, 1) + unix(instrument.issueAt) + unix(instrument.maturityAt) + unsignedHex(instrument.totalSupply),
      [instrumentAddress, controlledPolicyAddress, bondMint, treasury]);
  } else {
    const allocations = plan.allocations;
    if (allocations?.length !== 3 || new Set(allocations.map(row => row.walletAddress)).size !== 3 || new Set(allocations.map(row => row.investorId)).size !== 3 ||
        allocations.map(row => row.amount).join("/") !== "10/20/5" || plan.phase === "DISTRIBUTION" && (!selectedAllocations ||
          selectedAllocations.length !== allocations.length || allocations.some((row, index) => row.walletAddress !== selectedAllocations[index]?.walletAddress || row.amount !== selectedAllocations[index]?.amount))) throw invalid();
    for (const row of allocations) if (row.tokenAccount !== await associatedAddress(row.walletAddress, bondMint)) throw invalid();
    if (plan.phase === "DISTRIBUTION") {
      if (instrument.corporateActionAuthority !== wallet) throw invalid();
      const sourceHolding = await holding(treasury);
      for (const row of allocations) {
        ata(row.walletAddress, row.tokenAccount); const destinationHolding = await holding(row.tokenAccount);
        add(configured.programId, [wallet, wallet, instrumentAddress, controlledPolicyAddress, instrumentAuthority, bondMint, treasury, row.tokenAccount, sourceHolding, destinationHolding, TOKEN_PROGRAM],
          await instructionDiscriminator("controlled_transfer") + unsignedHex(row.amount), [treasury, row.tokenAccount]);
      }
    } else {
      const holdings = await Promise.all(allocations.map(row => controlledHoldingAddress(configured.programId, instrumentAddress, row.tokenAccount)));
      add(configured.programId, [wallet, instrumentAddress, controlledPolicyAddress, instrumentAuthority, bondMint, TOKEN_PROGRAM,
        ...allocations.flatMap((row, index) => [row.tokenAccount, holdings[index]!])], await instructionDiscriminator("activate_controlled_instrument"), [instrumentAddress]);
    }
  }
  requireReviewedTransaction(plan.serializedTransactionBase64, wallet, expected, writable, invalid);
  return plan;
}
