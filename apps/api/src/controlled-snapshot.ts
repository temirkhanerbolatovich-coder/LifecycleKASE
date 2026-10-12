import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildControlledCaptureRecord, buildSnapshotRegistrationInstruction, collectControlledTokenPositions,
  decodeControlledTokenPosition, type HolderRegistryCapture, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { readControlledCaptureState } from "./controlled-capture.js";
import { requireControlledRegistry } from "./controlled-policy.js";
import { TransactionWorkflowError, type WorkflowNetwork } from "./transaction-workflow.js";

export async function buildPolicySnapshotInstruction(input: Parameters<typeof buildSnapshotRegistrationInstruction>[0],
  tokenPolicy: string | undefined, holderTokenAccounts: readonly string[] = []) {
  const legacy = await buildSnapshotRegistrationInstruction(input);
  if (tokenPolicy !== "CONTROLLED_FROZEN_V2") return legacy;
  const controlled = await buildControlledCaptureRecord({ ...input, corporateActionAuthority: input.issuerAuthority, holderTokenAccounts });
  return { ...legacy, ...controlled.instruction };
}

/** Compares actual chain positions with every immutable canonical token source, including owner and balance. */
export function requireCapturedRowsMatch(holdings: readonly { tokenAccount: string; walletAddress: string; balance: bigint }[],
  canonical: unknown) {
  const payload = canonical as { investors: { wallets: { wallet_address: string; token_accounts: { address: string; balance: string }[] }[] }[] };
  try {
    const expected = payload.investors.flatMap(investor => investor.wallets.flatMap(wallet => wallet.token_accounts.map(account => ({
      tokenAccount: account.address, walletAddress: wallet.wallet_address, balance: BigInt(account.balance).toString() }))));
    const actual = holdings.map(row => ({ ...row, balance: row.balance.toString() }));
    const compare = (left: { tokenAccount: string }, right: { tokenAccount: string }) => left.tokenAccount < right.tokenAccount ? -1 : left.tokenAccount > right.tokenAccount ? 1 : 0;
    if (new Set(expected.map(row => row.tokenAccount)).size !== expected.length ||
        JSON.stringify(expected.sort(compare)) !== JSON.stringify(actual.sort(compare))) throw new Error("mismatch");
  } catch { throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Captured source ownership or balances differ from canonical snapshot"); }
}

/** Validate saved exact raw JSON independently of PostgreSQL JSONB object-key order. */
export function requireControlledSnapshotEvidence(value: unknown, canonical: unknown) {
  try {
    const evidence = value as { schema: string; registryCanonicalJson: string; registrySha256: string; startedSlot: string;
      startedAt: string; readSlot: number; registry: { supply: string; positions: { address: string; tokenProgramOwner: string;
        dataBase64: string; mintAddress: string; walletAddress: string; balance: string }[]; positivePositions: unknown[] } };
    const snapshot = canonical as { mint_address: string; mint_supply: string; solana_slot: string; block_time: string };
    if (evidence.schema !== "controlled-capture-v1" || typeof evidence.registryCanonicalJson !== "string" ||
        evidence.registryCanonicalJson.length > 1_000_000 || createHash("sha256").update(evidence.registryCanonicalJson).digest("hex") !== evidence.registrySha256 ||
        !isDeepStrictEqual(JSON.parse(evidence.registryCanonicalJson), evidence.registry) || evidence.startedSlot !== snapshot.solana_slot ||
        !/^[1-9][0-9]*$/.test(evidence.startedSlot) || !/^(0|[1-9][0-9]*)$/.test(evidence.startedAt) ||
        new Date(Number(evidence.startedAt) * 1000).toISOString() !== snapshot.block_time ||
        !Number.isSafeInteger(evidence.readSlot) || BigInt(evidence.readSlot) < BigInt(evidence.startedSlot) ||
        !Array.isArray(evidence.registry.positions) || !Array.isArray(evidence.registry.positivePositions)) throw new Error("invalid raw evidence");
    const positions = evidence.registry.positions.map(position => {
      const decoded = decodeControlledTokenPosition({ address: position.address, owner: position.tokenProgramOwner,
        executable: false, dataBase64: position.dataBase64 }, snapshot.mint_address);
      if (decoded.mintAddress !== position.mintAddress || decoded.walletAddress !== position.walletAddress ||
          decoded.balance.toString() !== position.balance) throw new Error("raw bytes disagree");
      return decoded;
    });
    const positive = positions.filter(position => position.balance > 0n);
    if (new Set(positions.map(position => position.address)).size !== positions.length || positive.length > 64 ||
        evidence.registry.supply !== snapshot.mint_supply || positive.reduce((total, position) => total + position.balance, 0n).toString() !== snapshot.mint_supply ||
        positive.some(position => position.state !== "FROZEN" || !position.immutableOwner || position.delegate !== null || position.closeAuthority !== null ||
          position.extensions.some(extension => ![7, 8, 11].includes(extension.type))) ||
        !isDeepStrictEqual(evidence.registry.positivePositions, evidence.registry.positions.filter(position => BigInt(position.balance) > 0n))) throw new Error("raw coverage differs");
    requireCapturedRowsMatch(positive.map(position => ({ tokenAccount: position.address, walletAddress: position.walletAddress, balance: position.balance })), canonical);
  } catch { throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Saved raw capture bytes, registry hash or canonical ownership differ"); }
}

export async function collectLockedControlledSnapshot(rpc: SolanaRpc,
  instrument: Parameters<typeof readControlledCaptureState>[1], actionId: string,
  options: WorkflowNetwork & { controlledRegistryEnabled?: boolean }) {
  if (!requireControlledRegistry(instrument, options)) throw new TransactionWorkflowError("INSTRUMENT_TOKEN_POLICY_INVALID", "A controlled instrument is required");
  const before = await readControlledCaptureState(rpc, instrument, actionId);
  const lock = before.capture;
  if (!lock || lock.committed || lock.finished || before.policy.captureAction !== before.actionAddress ||
      lock.startedSlot > BigInt(Number.MAX_SAFE_INTEGER) || lock.startedAt < 0n) {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_REQUIRED", "Confirm the original capture lock before reading holders");
  }
  const raw = await collectControlledTokenPositions(rpc, instrument.mintAddress!, Number(lock.startedSlot));
  const after = await readControlledCaptureState(rpc, instrument, actionId, raw.slot);
  if (!after.capture || after.capture.startedSlot !== lock.startedSlot || after.capture.startedAt !== lock.startedAt ||
      after.capture.committed || after.capture.finished || after.policy.captureAction !== before.actionAddress) {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_CHANGED", "The capture lock changed during finalized registry reads");
  }
  const wallets = new Map<string, HolderRegistryCapture["wallets"][number]>();
  for (const position of raw.positivePositions) {
    let wallet = wallets.get(position.walletAddress);
    if (!wallet) { wallet = { address: position.walletAddress, balance: 0n, tokenAccounts: [] }; wallets.set(position.walletAddress, wallet); }
    wallet.balance += position.balance; wallet.tokenAccounts.push({ address: position.address, balance: position.balance });
  }
  const capture: HolderRegistryCapture = { mintAddress: raw.mintAddress, slot: Number(lock.startedSlot), supply: raw.supply,
    totalBalance: raw.totalBalance, tokenAccounts: raw.positivePositions.map(position => ({ address: position.address,
      walletAddress: position.walletAddress, balance: position.balance })), wallets: [...wallets.values()] };
  const registry = JSON.parse(JSON.stringify(raw, (_, value) => typeof value === "bigint" ? value.toString() : value)) as Record<string, unknown>;
  const registryCanonicalJson = JSON.stringify(registry);
  return { capture, blockTime: new Date(Number(lock.startedAt) * 1000),
    captureEvidence: { schema: "controlled-capture-v1", controlledPolicyAddress: before.controlledPolicyAddress,
      controlledCaptureAddress: before.controlledCaptureAddress, startedSlot: lock.startedSlot.toString(), startedAt: lock.startedAt.toString(),
      readSlot: raw.slot, registry, registryCanonicalJson, registrySha256: createHash("sha256").update(registryCanonicalJson).digest("hex") } };
}
