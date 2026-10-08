import { SolanaSignAndSendTransaction, SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { signedPreparedTransaction, transactionSignature, unsignedTransactionForSigner,
  walletChainForCluster, type SupportedSnapshotCluster } from "./snapshot-workflow";

export function supportsPreparedTransaction(wallet: Wallet | undefined, cluster: SupportedSnapshotCluster): boolean {
  if (!wallet?.chains.includes(walletChainForCluster(cluster)) ||
      typeof (wallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined)?.connect !== "function") return false;
  if (cluster === "localnet") {
    const feature = wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
    return typeof feature?.signTransaction === "function" && feature.supportedTransactionVersions.includes(0);
  }
  const feature = wallet.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;
  return typeof feature?.signAndSendTransaction === "function" && feature.supportedTransactionVersions.includes(0);
}

/** Keeps the wallet signature available even when authentication or the broadcast response is lost. */
export async function signAndSubmitPrepared(input: {
  wallet: Wallet | undefined; walletAddress: string;
  plan: { cluster: SupportedSnapshotCluster; operationId: string; requiredSigner: string; serializedTransactionBase64: string };
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  submitPath: string; submitFields?: Record<string, unknown>;
  onSigning: () => void; onSignature: (signature: string) => void;
}) {
  const { wallet, plan, walletAddress } = input;
  if (!wallet || !supportsPreparedTransaction(wallet, plan.cluster) || plan.requiredSigner !== walletAddress) {
    throw new Error("Нужен кошелёк с поддержкой тестовой сети, v0 и выбранного signer.");
  }
  const chain = walletChainForCluster(plan.cluster);
  const featureName = plan.cluster === "localnet" ? SolanaSignTransaction : SolanaSignAndSendTransaction;
  const connected = await (wallet as WalletWithFeatures<StandardConnectFeature>).features[StandardConnect].connect();
  const account = connected.accounts.find(candidate => candidate.address === walletAddress && candidate.chains.includes(chain) && candidate.features.includes(featureName));
  if (!account) throw new Error("Выберите в Phantom тот же кошелёк, которым выполнен вход.");
  const unsigned = unsignedTransactionForSigner(plan.serializedTransactionBase64, walletAddress);
  input.onSigning();
  if (plan.cluster === "localnet") {
    const [output] = await (wallet as WalletWithFeatures<SolanaSignTransactionFeature>).features[SolanaSignTransaction].signTransaction({ account, chain, transaction: unsigned });
    if (!output) throw new Error("Phantom не вернул подписанную транзакцию.");
    const signed = signedPreparedTransaction(output.signedTransaction, plan.serializedTransactionBase64, walletAddress);
    input.onSignature(signed.signature);
    const response = await input.request(input.submitPath, { method: "POST", body: JSON.stringify({
      ...input.submitFields, operationId: plan.operationId, signedTransactionBase64: signed.signedTransactionBase64
    }) });
    if (response["operationId"] !== plan.operationId || response["signature"] !== signed.signature ||
        !["SUBMITTED", "FINALIZED"].includes(String(response["status"]))) throw new Error("API не подтвердил отправку исходной подписи. Повторите только finalized-проверку.");
  } else {
    const [output] = await (wallet as WalletWithFeatures<SolanaSignAndSendTransactionFeature>).features[SolanaSignAndSendTransaction].signAndSendTransaction({
      account, chain, transaction: unsigned, options: { preflightCommitment: "confirmed", skipPreflight: false }
    });
    if (!output) throw new Error("Кошелёк не вернул результат отправки.");
    input.onSignature(transactionSignature(output.signature));
  }
}
