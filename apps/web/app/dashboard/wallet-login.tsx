"use client";
import { LanguageSelector, useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";

import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, StandardEvents, type StandardConnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { useEffect, useMemo, useState } from "react";
import { OperatorWorkspace } from "./operator-workspace";
import { accountForAddress, accountOptionLabel, messageAccounts, reconcileAccountSelection, shortWalletAddress } from "./wallet-account-selection";
import { apiRequest, createOperatorRequest, OperatorApiError } from "./operator-api";

type LoginWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignMessageFeature>;
type OperatorUser = { id: string; displayName: string; role: string };
type Challenge = { challengeId: string; message: string; nonce: string; walletAddress: string };

function supportsOperatorLogin(wallet: Wallet): wallet is LoginWallet {
  const connect = wallet.features[StandardConnect] as { connect?: unknown } | undefined;
  const signMessage = wallet.features[SolanaSignMessage] as { signMessage?: unknown } | undefined;
  return typeof connect?.connect === "function" && typeof signMessage?.signMessage === "function";
}

function canonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function WalletLogin({ apiState }: { apiState: "ready" | "unavailable" }) {
  const { t, locale, displayMessage } = useLocale();
  const [wallets, setWallets] = useState<readonly LoginWallet[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [user, setUser] = useState<OperatorUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<readonly WalletAccount[]>([]);
  const [selectedAccountAddress, setSelectedAccountAddress] = useState("");
  const [message, setMessage] = useLocalizedTextState(t("core.checking.the.active.session"));
  const [busy, setBusy] = useState(true);
  const selectedWallet = useMemo(() => wallets[selectedIndex], [wallets, selectedIndex]);
  const operatorRequest = useMemo(() => createOperatorRequest(() => {
    setSessionExpired(true);
    setMessage(t("core.the.session.expired.sign.in.again.with.the.same.wallet.the.signed.attempt"));
  }, fetch, setConnectionLost), []);

  useEffect(() => {
    const walletRegistry = getWallets();
    const refreshWallets = () => {
      const supported = walletRegistry.get().filter(supportsOperatorLogin);
      setWallets(supported);
      setSelectedIndex((current) => Math.min(current, Math.max(0, supported.length - 1)));
    };
    refreshWallets();
    const stopRegister = walletRegistry.on("register", refreshWallets);
    const stopUnregister = walletRegistry.on("unregister", refreshWallets);
    void apiRequest("/api/v1/auth/session")
      .then((payload) => {
        const sessionUser = payload["user"];
        if (sessionUser && typeof sessionUser === "object") {
          setUser(sessionUser as OperatorUser);
          setWalletAddress(typeof payload["walletAddress"] === "string" ? payload["walletAddress"] : null);
          setMessage(t("core.the.operator.session.is.active"));
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof OperatorApiError && error.code === "AUTH_NOT_CONFIGURED"
          ? error.message : t("core.connect.a.registered.operator.wallet"));
      })
      .finally(() => setBusy(false));
    return () => { stopRegister(); stopUnregister(); };
  }, []);

  useEffect(() => {
    if (!selectedWallet) {
      setAvailableAccounts([]);
      setSelectedAccountAddress("");
      return;
    }

    const updateAccounts = (accounts: readonly WalletAccount[]) => {
      const signingAccounts = messageAccounts(accounts, []);
      setAvailableAccounts(signingAccounts);
      setSelectedAccountAddress((current) => reconcileAccountSelection(signingAccounts, current));
    };

    updateAccounts(selectedWallet.accounts);
    const events = (selectedWallet as Wallet).features[StandardEvents] as StandardEventsFeature[typeof StandardEvents] | undefined;
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      if (accounts) updateAccounts(accounts);
    });
  }, [selectedWallet]);

  async function login(requiredWalletAddress?: string): Promise<void> {
    if (!selectedWallet) {
      setMessage(t("core.no.compatible.solana.wallet.standard.wallet.was.found"));
      return;
    }
    setBusy(true);
    setMessage(t("core.waiting.for.wallet.permission"));
    try {
      const connected = await selectedWallet.features[StandardConnect].connect();
      const accounts = messageAccounts(availableAccounts, [...connected.accounts, ...selectedWallet.accounts]);
      setAvailableAccounts(accounts);
      const nextSelection = requiredWalletAddress ?? reconcileAccountSelection(accounts, selectedAccountAddress);
      setSelectedAccountAddress(nextSelection);
      const account = accountForAddress(accounts, nextSelection);
      if (requiredWalletAddress && !account) {
        throw new Error(t("core.select.the.same.operator.wallet.in.phantom.and.sign.in.again.to.restore"));
      }
      if (!account && accounts.length > 1) {
        setSelectedAccountAddress("");
        setMessage(t("core.phantom.connected.several.accounts.select.the.operator.address.and.sign.in.again"));
        return;
      }
      if (!account) throw new Error(t("core.the.selected.account.cannot.sign.messages"));
      const challengePayload = await apiRequest("/api/v1/auth/challenge", {
        method: "POST", body: JSON.stringify({ walletAddress: account.address })
      });
      const challenge = challengePayload as Challenge;
      if (typeof challenge.challengeId !== "string" || typeof challenge.nonce !== "string" ||
          typeof challenge.message !== "string" || challenge.walletAddress !== account.address) {
        throw new Error(t("core.the.server.returned.an.invalid.signing.request"));
      }
      setMessage(t("core.sign.the.login.message.in.your.wallet.it.does.not.send.a.transaction"));
      const messageBytes = new TextEncoder().encode(challenge.message);
      const [signed] = await selectedWallet.features[SolanaSignMessage].signMessage({
        account, message: messageBytes
      });
      if (!signed || !Uint8Array.from(signed.signedMessage).every((byte, index) => byte === messageBytes[index]) ||
          signed.signedMessage.length !== messageBytes.length) {
        throw new Error(t("core.the.wallet.changed.the.message.bytes.login.was.stopped"));
      }
      const verified = await apiRequest("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          signature: canonicalBase64(Uint8Array.from(signed.signature))
        })
      });
      if (!verified["user"] || typeof verified["user"] !== "object") {
        throw new Error(t("core.the.server.did.not.return.an.operator.profile"));
      }
      setUser(verified["user"] as OperatorUser);
      setSessionExpired(false);
      setWalletAddress(account.address);
      setSelectedAccountAddress(account.address);
      setMessage(t("core.signed.in"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("core.wallet.login.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await apiRequest("/api/v1/auth/logout", { method: "POST", body: "{}" });
      setUser(null);
      setSessionExpired(false);
      setWalletAddress(null);
      setMessage(t("core.session.ended"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("core.could.not.end.the.session"));
    } finally {
      setBusy(false);
    }
  }

  async function signInvestorWalletMessage(address: string, message: string): Promise<string> {
    if (!selectedWallet) throw new Error(t("core.no.compatible.solana.wallet.was.found"));
    const connected = await selectedWallet.features[StandardConnect].connect();
    const accounts = messageAccounts(availableAccounts, [...connected.accounts, ...selectedWallet.accounts]);
    setAvailableAccounts(accounts);
    const account = accountForAddress(accounts, address);
    if (!account) {
      throw new Error(t("core.switch.phantom.to.the.specified.pending.wallet.and.confirm.again"));
    }
    const messageBytes = new TextEncoder().encode(message);
    const [signed] = await selectedWallet.features[SolanaSignMessage].signMessage({ account, message: messageBytes });
    if (!signed || signed.signedMessage.length !== messageBytes.length ||
        !Uint8Array.from(signed.signedMessage).every((byte, index) => byte === messageBytes[index])) {
      throw new Error(t("core.the.wallet.changed.the.message.bytes.confirmation.was.stopped"));
    }
    return canonicalBase64(Uint8Array.from(signed.signature));
  }

  if (user && walletAddress && ["ADMINISTRATOR", "AUDITOR"].includes(user.role)) {
    const connectionSettings = <>
      <div className={`mt-4 rounded-2xl border p-4 ${selectedAccountAddress === walletAddress ? "border-[#dce6e0] bg-[#f5f8f6]" : "border-[#edcf98] bg-[#fff8e9]"}`}>
        <p className="text-xs font-semibold text-[#6b7a72]">{t("core.currently.selected.in.phantom")}</p>
        <p className="mt-1 font-mono text-sm font-semibold" title={selectedAccountAddress || undefined}>{selectedAccountAddress ? shortWalletAddress(selectedAccountAddress) : t("core.no.account.selected")}</p>
        <p className="mt-2 text-xs leading-5 text-[#697970]">{selectedAccountAddress === walletAddress
          ? t("core.this.is.the.operator.account.temporarily.switch.phantom.accounts.to.verify.an.investor")
          : t("core.a.different.account.is.selected.the.operator.session.remains.active.restore.the.operator")}</p>
      </div>
      {wallets.length > 1 && <label className="mt-4 block text-sm">{t("core.wallet.provider")}
        <select className="mt-2 w-full rounded-xl border border-[#cdd8d1] bg-white px-3 py-2.5" disabled={busy} value={selectedIndex} onChange={(event) => {
          setSelectedIndex(Number(event.target.value)); setAvailableAccounts([]); setSelectedAccountAddress("");
        }}>{wallets.map((wallet, index) => <option key={`${wallet.name}-${index}`} value={index}>{wallet.name}</option>)}</select>
      </label>}
    </>;
    return <OperatorWorkspace user={user} walletAddress={walletAddress} selectedAccountAddress={selectedAccountAddress}
      sessionExpired={sessionExpired} busy={busy} message={message} wallet={selectedWallet} request={operatorRequest}
      apiState={apiState} connectionLost={connectionLost} connectionSettings={connectionSettings} signWalletMessage={signInvestorWalletMessage}
      onBusyChange={setBusy} onRecover={() => void login(walletAddress)} onLogout={() => void logout()} />;
  }

  return (
    <main className="terminal-login-card mx-auto max-w-xl p-6 sm:p-8">
      <div className="mb-4 flex justify-end"><LanguageSelector /></div>
      <p className="section-kicker">{t("core.secure.login")}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#173426]">{t("core.sign.in.with.your.operator.wallet")}</h1>
      <p className="mt-3 text-sm leading-6 text-[#65756c]">{t("core.phantom.signs.a.one.time.message.no.transaction.is.created.and.no.funds")}</p>
      <div className="mt-6">
          <div className="rounded-xl border border-[#dbe5df] bg-[#f7faf8] p-4 text-sm leading-6 text-[#53695d]">
            <p className="font-semibold text-[#163f2b]">{t("core.select.a.registered.account")}</p>
            <p className="mt-1">{t("core.an.investor.address.cannot.sign.in.as.an.operator.check.the.address.ending")}</p>
          </div>
          {wallets.length > 1 && (
            <label className="block text-sm font-medium">
              {t("core.wallet.provider")}
              <select className="mt-2 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2" value={selectedIndex} onChange={(event) => {
                setSelectedIndex(Number(event.target.value));
                setAvailableAccounts([]);
                setSelectedAccountAddress("");
              }}>
                {wallets.map((wallet, index) => <option key={`${wallet.name}-${index}`} value={index}>{wallet.name}</option>)}
              </select>
            </label>
          )}
          {availableAccounts.length > 0 && (
            <label className="mt-4 block text-sm font-medium">
              {availableAccounts.length === 1 ? t("core.active.solana.account") : t("core.solana.account")}
              <select className="mt-2 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2" disabled={busy}
                value={selectedAccountAddress} onChange={(event) => setSelectedAccountAddress(event.target.value)}>
                {availableAccounts.length > 1 && <option value="">{t("core.select.the.operator.address")}</option>}
                {availableAccounts.map((account) => (
                  <option key={account.address} value={account.address}>{accountOptionLabel(account)}</option>
                ))}
              </select>
              <span className="mt-2 block text-xs leading-5 text-[#61746a]">{t("core.check.the.address.ending.several.phantom.accounts.may.use.the.same.profile.name")}</span>
            </label>
          )}
          <button className="primary-button mt-5 w-full justify-center"
            disabled={busy || wallets.length === 0 || (availableAccounts.length > 1 && !selectedAccountAddress)} onClick={() => void login()}>
            {busy ? t("core.checking") : wallets.length === 0 ? t("core.solana.wallet.not.found") : t("core.loginThrough", { wallet: selectedWallet?.name ?? "" })}
          </button>
        </div>
      <p aria-live="polite" className="mt-4 rounded-lg bg-[#f4f7f5] px-3 py-2 text-xs leading-5 text-[#52675b]">{message}</p>
      <p className="mt-3 text-center text-xs leading-5 text-[#7a877f]">{t("core.the.application.never.receives.your.seed.phrase.or.private.key")}</p>
      <a href="/qa" className="secondary-button mt-4 w-full justify-center">{t("core.walletless.qa.sandbox")}</a>
    </main>
  );
}
