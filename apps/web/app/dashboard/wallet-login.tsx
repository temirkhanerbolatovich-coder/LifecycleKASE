"use client";

import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, StandardEvents, type StandardConnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { useEffect, useMemo, useState } from "react";
import { OperatorWorkspace } from "./operator-workspace";
import { accountForAddress, accountOptionLabel, messageAccounts, reconcileAccountSelection, shortWalletAddress } from "./wallet-account-selection";
import { apiRequest, createOperatorRequest } from "./operator-api";

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
  const [wallets, setWallets] = useState<readonly LoginWallet[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [user, setUser] = useState<OperatorUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<readonly WalletAccount[]>([]);
  const [selectedAccountAddress, setSelectedAccountAddress] = useState("");
  const [message, setMessage] = useState("Проверяем активную сессию…");
  const [busy, setBusy] = useState(true);
  const selectedWallet = useMemo(() => wallets[selectedIndex], [wallets, selectedIndex]);
  const operatorRequest = useMemo(() => createOperatorRequest(() => {
    setSessionExpired(true);
    setMessage("Сессия истекла. Восстановите вход тем же кошельком; подписанная попытка остаётся на экране.");
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
          setMessage("Сессия оператора активна.");
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error && error.message.includes("пока не включён")
          ? error.message : "Подключите зарегистрированный кошелёк оператора.");
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
      setMessage("Совместимый Solana Wallet Standard кошелёк не найден.");
      return;
    }
    setBusy(true);
    setMessage("Ожидаем разрешение кошелька…");
    try {
      const connected = await selectedWallet.features[StandardConnect].connect();
      const accounts = messageAccounts(availableAccounts, [...connected.accounts, ...selectedWallet.accounts]);
      setAvailableAccounts(accounts);
      const nextSelection = requiredWalletAddress ?? reconcileAccountSelection(accounts, selectedAccountAddress);
      setSelectedAccountAddress(nextSelection);
      const account = accountForAddress(accounts, nextSelection);
      if (requiredWalletAddress && !account) {
        throw new Error("Для восстановления сессии выберите в Phantom тот же кошелёк оператора и повторите вход.");
      }
      if (!account && accounts.length > 1) {
        setSelectedAccountAddress("");
        setMessage("Phantom подключил несколько аккаунтов. Выберите адрес оператора и нажмите вход ещё раз.");
        return;
      }
      if (!account) throw new Error("Кошелёк не поддерживает подпись сообщений выбранным аккаунтом.");
      const challengePayload = await apiRequest("/api/v1/auth/challenge", {
        method: "POST", body: JSON.stringify({ walletAddress: account.address })
      });
      const challenge = challengePayload as Challenge;
      if (typeof challenge.challengeId !== "string" || typeof challenge.nonce !== "string" ||
          typeof challenge.message !== "string" || challenge.walletAddress !== account.address) {
        throw new Error("Сервер вернул некорректный запрос на подпись.");
      }
      setMessage("Подпишите сообщение входа в кошельке. Оно не отправляет транзакцию.");
      const messageBytes = new TextEncoder().encode(challenge.message);
      const [signed] = await selectedWallet.features[SolanaSignMessage].signMessage({
        account, message: messageBytes
      });
      if (!signed || !Uint8Array.from(signed.signedMessage).every((byte, index) => byte === messageBytes[index]) ||
          signed.signedMessage.length !== messageBytes.length) {
        throw new Error("Кошелёк изменил подписываемое сообщение; вход остановлен.");
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
        throw new Error("Сервер не вернул профиль оператора.");
      }
      setUser(verified["user"] as OperatorUser);
      setSessionExpired(false);
      setWalletAddress(account.address);
      setSelectedAccountAddress(account.address);
      setMessage("Вход выполнен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить вход через кошелёк.");
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
      setMessage("Сессия завершена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось завершить сессию.");
    } finally {
      setBusy(false);
    }
  }

  async function signInvestorWalletMessage(address: string, message: string): Promise<string> {
    if (!selectedWallet) throw new Error("Совместимый Solana-кошелёк не найден.");
    const connected = await selectedWallet.features[StandardConnect].connect();
    const accounts = messageAccounts(availableAccounts, [...connected.accounts, ...selectedWallet.accounts]);
    setAvailableAccounts(accounts);
    const account = accountForAddress(accounts, address);
    if (!account) {
      throw new Error("Переключите активный аккаунт Phantom на указанный PENDING-кошелёк и повторите подтверждение.");
    }
    const messageBytes = new TextEncoder().encode(message);
    const [signed] = await selectedWallet.features[SolanaSignMessage].signMessage({ account, message: messageBytes });
    if (!signed || signed.signedMessage.length !== messageBytes.length ||
        !Uint8Array.from(signed.signedMessage).every((byte, index) => byte === messageBytes[index])) {
      throw new Error("Кошелёк изменил подписываемое сообщение; подтверждение остановлено.");
    }
    return canonicalBase64(Uint8Array.from(signed.signature));
  }

  if (user && walletAddress && ["ADMINISTRATOR", "AUDITOR"].includes(user.role)) {
    const connectionSettings = <>
      <div className={`mt-4 rounded-2xl border p-4 ${selectedAccountAddress === walletAddress ? "border-[#dce6e0] bg-[#f5f8f6]" : "border-[#edcf98] bg-[#fff8e9]"}`}>
        <p className="text-xs font-semibold text-[#6b7a72]">Сейчас выбран в Phantom</p>
        <p className="mt-1 font-mono text-sm font-semibold" title={selectedAccountAddress || undefined}>{selectedAccountAddress ? shortWalletAddress(selectedAccountAddress) : "Аккаунт не выбран"}</p>
        <p className="mt-2 text-xs leading-5 text-[#697970]">{selectedAccountAddress === walletAddress
          ? "Это аккаунт оператора. Для подтверждения кошелька инвестора временно переключите аккаунт в Phantom."
          : "Выбран другой аккаунт. Сессия оператора остаётся активной; верните аккаунт оператора перед on-chain транзакцией."}</p>
      </div>
      {wallets.length > 1 && <label className="mt-4 block text-sm">Провайдер кошелька
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
      <p className="section-kicker">Безопасный вход</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#173426]">Войдите кошельком оператора</h1>
      <p className="mt-3 text-sm leading-6 text-[#65756c]">Phantom подпишет одноразовое сообщение. Транзакция не создаётся, средства не перемещаются.</p>
      <div className="mt-6">
          <div className="rounded-xl border border-[#dbe5df] bg-[#f7faf8] p-4 text-sm leading-6 text-[#53695d]">
            <p className="font-semibold text-[#163f2b]">Выберите зарегистрированный аккаунт</p>
            <p className="mt-1">Адрес инвестора не подходит для входа оператора. Сверьте последние символы адреса перед подписью.</p>
          </div>
          {wallets.length > 1 && (
            <label className="block text-sm font-medium">
              Провайдер кошелька
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
              {availableAccounts.length === 1 ? "Активный аккаунт Solana" : "Аккаунт Solana"}
              <select className="mt-2 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2" disabled={busy}
                value={selectedAccountAddress} onChange={(event) => setSelectedAccountAddress(event.target.value)}>
                {availableAccounts.length > 1 && <option value="">Выберите адрес оператора</option>}
                {availableAccounts.map((account) => (
                  <option key={account.address} value={account.address}>{accountOptionLabel(account)}</option>
                ))}
              </select>
              <span className="mt-2 block text-xs leading-5 text-[#61746a]">Проверьте окончание адреса. Имя профиля Phantom может быть одинаковым у нескольких аккаунтов.</span>
            </label>
          )}
          <button className="primary-button mt-5 w-full justify-center"
            disabled={busy || wallets.length === 0 || (availableAccounts.length > 1 && !selectedAccountAddress)} onClick={() => void login()}>
            {busy ? "Проверка…" : wallets.length === 0 ? "Solana-кошелёк не найден" : `Войти через ${selectedWallet?.name}`}
          </button>
        </div>
      <p aria-live="polite" className="mt-4 rounded-lg bg-[#f4f7f5] px-3 py-2 text-xs leading-5 text-[#52675b]">{message}</p>
      <p className="mt-3 text-center text-xs leading-5 text-[#7a877f]">Приложение не получает seed phrase или private key.</p>
    </main>
  );
}
