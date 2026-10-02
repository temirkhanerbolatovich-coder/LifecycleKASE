"use client";

import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, StandardEvents, type StandardConnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { useEffect, useMemo, useState } from "react";
import { SnapshotPanel } from "./snapshot-panel";
import { InvestorPanel } from "./investor-panel";
import { InstrumentPanel } from "./instrument-panel";
import { accountForAddress, accountOptionLabel, messageAccounts, reconcileAccountSelection, shortWalletAddress } from "./wallet-account-selection";

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

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  switch (payload["code"]) {
    case "AUTH_NOT_CONFIGURED":
      return "Вход операторов пока не включён в этой среде.";
    case "UNAUTHORIZED_WALLET":
      return "Этот кошелёк не зарегистрирован как кошелёк оператора.";
    case "ORIGIN_NOT_ALLOWED":
      return "Текущий адрес приложения не разрешён сервером.";
    case "INVALID_CHALLENGE":
      return "Запрос на вход истёк. Повторите подключение.";
    case "INVALID_SIGNATURE":
      return "Подпись не соответствует выбранному адресу. Выберите нужный аккаунт Phantom и повторите.";
    case "TRANSACTION_NOT_FINALIZED":
      return "Транзакция ещё не финализирована. Подождите и повторите только проверку.";
    case "AUTH_RATE_LIMITED":
      return "Слишком много запросов. Подождите перед следующей проверкой.";
    case "REGISTRY_CAPTURE_LOCKED":
      return "Изменения реестра временно заблокированы на время формирования snapshot.";
    case "VERIFIED_WALLET_REQUIRED":
      return "Сначала подтвердите хотя бы один кошелёк инвестора.";
    case "ELIGIBILITY_ALREADY_DECIDED":
      return "Решение по допуску уже принято. Обновите реестр.";
    case "WALLET_ALREADY_REVOKED":
      return "Кошелёк уже отозван. Обновите реестр.";
    case "INSTRUMENT_CONFLICT":
      return "Эмитент или тикер уже зарегистрирован. Обновите список инструментов.";
    case "SETTLEMENT_ASSET_CONFLICT":
      return "Настройка KZT-Test не соответствует выбранной тестовой сети.";
    default:
      return typeof payload["message"] === "string" ? payload["message"] : fallback;
  }
}

async function apiRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(15_000)
  });
  const payload = await responseJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, "API отклонил запрос."));
  return payload;
}

export function WalletLogin() {
  const [wallets, setWallets] = useState<readonly LoginWallet[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [user, setUser] = useState<OperatorUser | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<readonly WalletAccount[]>([]);
  const [selectedAccountAddress, setSelectedAccountAddress] = useState("");
  const [message, setMessage] = useState("Проверяем активную сессию…");
  const [busy, setBusy] = useState(true);
  const selectedWallet = useMemo(() => wallets[selectedIndex], [wallets, selectedIndex]);

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

  async function login(): Promise<void> {
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
      const nextSelection = reconcileAccountSelection(accounts, selectedAccountAddress);
      setSelectedAccountAddress(nextSelection);
      const account = accountForAddress(accounts, nextSelection);
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

  return (
    <div className="rounded-2xl border border-[#dbe5df] bg-white p-7 shadow-[0_14px_50px_-30px_rgba(16,35,28,0.3)]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#28744a]">Доступ оператора</p>
      {user ? (
        <div className="mt-5">
          <div className="rounded-xl border border-[#b9dec8] bg-[#eff9f2] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#28744a]">Сессия оператора активна</p>
                <p className="mt-1 font-semibold">{user.displayName || "Оператор"}</p>
              </div>
              <span className="status-ready">{user.role === "ADMINISTRATOR" ? "Администратор" : "Аудитор"}</span>
            </div>
            <p className="mt-3 text-xs text-[#53695d]">Вход выполнен адресом <span className="font-mono font-semibold" title={walletAddress ?? undefined}>{walletAddress ? shortWalletAddress(walletAddress) : "подтверждённый кошелёк"}</span></p>
          </div>
          {selectedAccountAddress && (
            <div className={`mt-3 rounded-xl border p-4 ${selectedAccountAddress === walletAddress ? "border-[#dbe5df] bg-[#f7faf8]" : "border-[#efd29d] bg-[#fff8eb]"}`}>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#61746a]">Сейчас выбран в Phantom</p>
              <p className="mt-1 font-mono text-sm font-semibold" title={selectedAccountAddress}>{shortWalletAddress(selectedAccountAddress)}</p>
              <p className="mt-2 text-xs leading-5 text-[#61746a]">{selectedAccountAddress === walletAddress
                ? "Это кошелёк оператора. Переключите аккаунт только когда нужно подтвердить кошелёк инвестора."
                : "Выбран другой аккаунт. Сессия оператора сохранена — теперь им можно подтвердить соответствующий кошелёк инвестора."}</p>
            </div>
          )}
          {wallets.length > 1 && (
            <label className="mt-4 block text-sm">Провайдер кошелька
              <select className="mt-2 w-full rounded-lg border px-3 py-2" disabled={busy} value={selectedIndex} onChange={(event) => {
                setSelectedIndex(Number(event.target.value));
                setAvailableAccounts([]);
                setSelectedAccountAddress("");
              }}>
                {wallets.map((wallet, index) => <option key={`${wallet.name}-${index}`} value={index}>{wallet.name}</option>)}
              </select>
            </label>
          )}
          {['ADMINISTRATOR', 'AUDITOR'].includes(user.role) && (
            <InstrumentPanel key={`instruments-${user.id}`} role={user.role} request={apiRequest} />
          )}
          {["ADMINISTRATOR", "AUDITOR"].includes(user.role) && (
            <InvestorPanel key={user.id} role={user.role} request={apiRequest}
              activeWalletAddress={selectedAccountAddress}
              signWalletMessage={user.role === "ADMINISTRATOR" ? signInvestorWalletMessage : undefined} />
          )}
          {user.role === "ADMINISTRATOR" && walletAddress && (
            <details className="mt-6 rounded-xl border border-[#dbe5df] bg-[#f8faf9] px-4">
              <summary className="cursor-pointer py-4 text-sm font-semibold">Расширенные операции · Snapshot Localnet / Devnet</summary>
              <p className="text-xs leading-5 text-[#61746a]">Откройте этот раздел только для подготовленного корпоративного действия с известным UUID. Сеть определяется сервером и повторно проверяется перед подписью.</p>
              <SnapshotPanel key={walletAddress} wallet={selectedWallet} walletAddress={walletAddress} request={apiRequest} onBusyChange={setBusy} />
            </details>
          )}
          <button className="mt-5 rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <div className="rounded-xl border border-[#dbe5df] bg-[#f7faf8] p-4 text-sm leading-6 text-[#53695d]">
            <p className="font-semibold text-[#163f2b]">1. Выберите кошелёк оператора</p>
            <p className="mt-1">Для входа нужен заранее зарегистрированный адрес администратора. Кошелёк инвестора используется позже и не сможет войти как оператор.</p>
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
          <button className="mt-5 rounded-lg bg-[#163f2b] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || wallets.length === 0 || (availableAccounts.length > 1 && !selectedAccountAddress)} onClick={() => void login()}>
            {busy ? "Проверка…" : wallets.length === 0 ? "Solana-кошелёк не найден" : `Войти через ${selectedWallet?.name}`}
          </button>
        </div>
      )}
      <p aria-live="polite" className="mt-4 rounded-lg bg-[#f4f7f5] px-3 py-2 text-xs leading-5 text-[#52675b]">{message}</p>
      <p className="mt-3 text-xs leading-5 text-[#8a5b18]">Подпись входа не отправляет транзакцию и не разрешает выплату.</p>
    </div>
  );
}
