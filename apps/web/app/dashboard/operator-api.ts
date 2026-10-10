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
    case "SESSION_REQUIRED":
    case "SESSION_INVALID":
      return "Сессия оператора истекла или недоступна. Войдите снова тем же кошельком и повторите только проверку уже подписанной транзакции.";
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
    case "FINALIZED_SNAPSHOT_REQUIRED":
      return "Сначала завершите finalized-проверку snapshot. Подписание само по себе не завершает этот шаг.";
    case "CALCULATION_NOT_ALLOWED":
      return "Расчёт доступен после finalized snapshot или возврата на доработку.";
    case "RECEIVER_REQUIRED":
      return "Выберите активный проверенный кошелёк для каждого инвестора.";
    case "CALCULATION_CHANGED":
      return "Сохранённый расчёт или допуск изменился. Верните действие на доработку и пересчитайте по прежнему snapshot.";
    case "CALCULATION_INCOMPLETE":
      return "Начисления, суммы или количество получателей не согласованы. Обновите данные и проверьте расчёт.";
    case "ELIGIBILITY_BLOCKED":
      return "Допуск инвестора или кошелёк получателя блокирует согласование/исполнение. Проверьте реестр и начисления.";
    case "REVIEW_NOT_ALLOWED":
      return "Решение не соответствует текущему этапу согласования. Обновите карточку действия.";
    case "APPROVAL_REQUIRED":
      return "Исполнение требует явного согласования начислений.";
    case "COUPON_NOT_DUE":
      return "Время исполнения ещё не наступило в подтверждённом состоянии сети. Повторите подготовку после даты выплаты.";
    case "COUPON_INCOMPLETE":
      return "Подтвердите все выплаты перед подготовкой итогового документа.";
    case "COUPON_CONFIRMATION_REQUIRED":
    case "ACTION_OPERATION_PENDING":
      return "Сначала проверьте результат сохранённой попытки по исходной подписи.";
    case "ENTITLEMENT_ALREADY_EXECUTED":
      return "Это начисление уже исполнено. Повторная выплата заблокирована.";
    case "COUPON_RESERVE_REQUIRED":
      return "В резерве недостаточно средств для выбранной выплаты.";
    case "COUPON_EXECUTION_DISABLED":
      return "Выплаты ещё не включены в этой среде. Доступна проверка текущего этапа.";
    case "RECEIPT_INTEGRITY":
    case "RECONCILIATION_REQUIRED":
    case "COUPON_RECEIPT_MISMATCH":
    case "COUPON_BALANCE_PROOF":
      return "Суммы, квитанции и подтверждённые данные не совпадают. Сохранённую попытку нужно сверить; повторная отправка не поможет.";
    case "ACTION_RECORD_TOO_SOON":
      return "До record date осталось меньше минуты. Создайте новый черновик с будущим временем; подписанную попытку проверяйте отдельно.";
    case "INVALID_ACTION_DATES":
      return "Даты действия не соответствуют сроку инструмента или record date позже исполнения.";
    case "ACTION_CANCEL_PENDING":
      return "Для действия уже подготовлена отмена. Сначала завершите проверку этой попытки.";
    case "SNAPSHOT_WINDOW_MISSED":
      return "Окно capture закрыто. Обновите карточку и проверьте окно snapshot; для подтверждённого пропуска создайте новое действие.";
    case "RECORD_DATE_NOT_REACHED":
      return "Окно snapshot ещё не открылось. Дождитесь record date и повторите подготовку в пределах окна.";
    case "SNAPSHOT_SLOT_OUTSIDE_WINDOW":
      return "Finalized slot ещё не достиг record date. Подождите и повторите подготовку в пределах окна.";
    case "ACTION_CONFLICT":
    case "TRANSACTION_CONFLICT":
      return "Состояние действия изменилось. Обновите карточку и восстановите существующую попытку.";
    case "TRANSACTION_HISTORY_UNAVAILABLE":
    case "TRANSACTION_UNAVAILABLE":
      return "RPC не предоставляет транзакцию для сверки. Она могла уже изменить on-chain состояние. Не подписывайте повторно; нужно проверить историю валидатора и созданные аккаунты.";
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
    case "WALLET_MISMATCH":
      return "Кошелёк сессии не совпадает с issuer authority инструмента.";
    case "MINT_ADDRESS_OCCUPIED":
      return "Расчётный адрес mint уже занят. Не отправляйте транзакцию; проверьте предыдущую попытку.";
    case "TRANSACTION_MISMATCH":
      return "Finalized-транзакция не совпадает с подготовленным планом.";
    case "MINT_STATE_MISMATCH":
    case "TREASURY_STATE_MISMATCH":
      return "On-chain состояние mint или treasury не прошло обязательную сверку.";
    default:
      return typeof payload["message"] === "string" ? payload["message"] : fallback;
  }
}

export async function apiRequest(path: string, init?: RequestInit, fetchRequest: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetchRequest(path, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(15_000)
  }); } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new OperatorApiError("CONNECTION_UNAVAILABLE", 0, "Потеряна связь с API или истекло время ожидания. Сохраните исходную попытку и подпись; проверьте результат после восстановления связи.");
  }
  const payload = await responseJson(response);
  if (!response.ok) throw new OperatorApiError(typeof payload["code"] === "string" ? payload["code"] : undefined,
    response.status, errorMessage(payload, "API отклонил запрос."));
  return payload;
}

export class OperatorApiError extends Error {
  constructor(public readonly code: string | undefined, public readonly status: number, message: string) {
    super(message); this.name = "OperatorApiError";
  }
}

/** Reports lost authentication without retrying a request that may submit a transaction. */
export function createOperatorRequest(onSessionExpired: () => void, fetchRequest: typeof fetch = fetch, onConnectionChange?: (lost: boolean) => void) {
  return async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    try { const result = await apiRequest(path, init, fetchRequest); onConnectionChange?.(false); return result; }
    catch (error) {
      if (error instanceof OperatorApiError && error.status === 401 &&
          (error.code === "SESSION_REQUIRED" || error.code === "SESSION_INVALID")) onSessionExpired();
      if (error instanceof OperatorApiError && error.code === "CONNECTION_UNAVAILABLE") onConnectionChange?.(true);
      throw error;
    }
  };
}
