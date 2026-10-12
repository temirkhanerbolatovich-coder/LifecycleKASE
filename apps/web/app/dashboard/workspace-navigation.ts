import { getDisplayLocale, translateStoredMessage, type Locale } from "./locale";
import { ACTION_MASTER_STEPS, type ActionMasterStep } from "./action-master-workflow";
export const WORKSPACE_SECTIONS = [
  { id: "overview", label: "Обзор", shortLabel: "Обзор", description: "Текущий этап и быстрый переход к работе" },
  { id: "actions", label: "Корпоративные действия", shortLabel: "Действия", description: "Фиксация держателей, начисления и выплаты" },
  { id: "instruments", label: "Инструменты", shortLabel: "Инструменты", description: "Выпуск и состояние тестовых облигаций" },
  { id: "investors", label: "Инвесторы", shortLabel: "Инвесторы", description: "Получатели, кошельки и допуск" },
  { id: "transactions", label: "Транзакции", shortLabel: "Транзакции", description: "Подписи, состояние сети и сохранённые попытки" },
  { id: "audit", label: "Аудит", shortLabel: "Аудит", description: "История операций и решений" },
  { id: "system", label: "Система", shortLabel: "Система", description: "Подключение кошелька и служебные операции" }
] as const;

export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]["id"];

const SECTION_IDS = new Set<string>(WORKSPACE_SECTIONS.map(section => section.id));

export function workspaceSectionFromHash(hash: string): WorkspaceSection {
  const value = hash.replace(/^#/, "").split("?")[0]!.trim().toLowerCase();
  return SECTION_IDS.has(value) ? value as WorkspaceSection : "overview";
}

export function workspaceSelectionFromHash(hash: string, section: WorkspaceSection): string | null {
  if (workspaceSectionFromHash(hash) !== section) return null;
  const value = new URLSearchParams(hash.split("?")[1] ?? "").get("selected");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export function workspaceSectionHash(section: WorkspaceSection, selected?: string | null, step?: ActionMasterStep | null): string {
  const selection = selected && workspaceSelectionFromHash(`#${section}?selected=${selected}`, section) ? `?selected=${selected}` : "";
  return `#${section}${selection}${section === "actions" && selection && step && ACTION_MASTER_STEPS.includes(step) ? `&step=${step}` : ""}`;
}

/** A step deep link only applies to the selected action; unknown values cannot select controls. */
export function workspaceActionStepFromHash(hash: string, actionId: string): ActionMasterStep | null {
  if (workspaceSelectionFromHash(hash, "actions")?.toLowerCase() !== actionId.toLowerCase()) return null;
  const value = new URLSearchParams(hash.split("?")[1] ?? "").get("step");
  return value && ACTION_MASTER_STEPS.includes(value as ActionMasterStep) ? value as ActionMasterStep : null;
}

export function getWorkspaceSections(locale: Locale = getDisplayLocale()) {
  return WORKSPACE_SECTIONS.map(section => ({ ...section, label: translateStoredMessage(section.label, locale), shortLabel: translateStoredMessage(section.shortLabel, locale), description: translateStoredMessage(section.description, locale) }));
}
