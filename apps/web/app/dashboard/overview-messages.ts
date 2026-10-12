import type { Locale } from "./locale";
const text = {
  ru: { active: "Активные инструменты", open: "Незавершённые действия", unknown: "Требуют проверки подписи", scope: "Все записи настроенной сети",
    updated: "Данные на", period: "Период исполнения", payable: "Рассчитано к исполнению", paid: "Подтверждено выплат", uncalculated: "Действий без расчёта",
    noAmount: "Нет расчёта", noAssets: "В этом периоде нет действий", simulatedAsset: "Тестовый актив", coverage: "Доступный баланс treasury и резерв проверяются в карточке действия.",
    queue: "Очередь требует внимания", bounded: "Приоритетная очередь", of: "из", empty: "В настроенной сети нет незавершённых действий.",
    partial: "Суммы относятся только к сохранённым начислениям. Действия без расчёта в суммы не включены.", invalid: "Серверная сводка неполная или противоречивая. Обновите данные.",
    unknownNext: "Проверить исходную подпись", stale: "Сводка показывает последнюю успешную загрузку. Сейчас обновление недоступно." },
  en: { active: "Active instruments", open: "Open actions", unknown: "Signature checks needed", scope: "All records on the configured network",
    updated: "Data as of", period: "Execution period", payable: "Calculated amount outstanding", paid: "Finalized payments", uncalculated: "Actions without calculations",
    noAmount: "Not calculated", noAssets: "No actions in this period", simulatedAsset: "Test asset", coverage: "Read treasury balance and reserved funds in the action detail.",
    queue: "Actions needing attention", bounded: "Priority queue", of: "of", empty: "No open actions on the configured network.",
    partial: "Amounts include saved entitlements only. Uncalculated actions are excluded from monetary totals.", invalid: "The server summary is incomplete or inconsistent. Reload the data.",
    unknownNext: "Verify the original signature", stale: "This summary retains the last successful load. Refresh is currently unavailable." },
};
export function overviewMessages(locale: Locale) { return text[locale]; }
