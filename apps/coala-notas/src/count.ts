import type { User } from "@firebase/auth";
import * as FileSystem from "expo-file-system/legacy";

import { authenticatedJson } from "./upload";

export type CountExitReason = string;
export type CountItem = {
  lotId: string;
  productName: string;
  lotNumber: string;
  expiryDate: string | null;
  systemQuantity: number;
  displayUnit: string;
  exitQuantity: number;
  exitReason: CountExitReason;
  exitNotes: string;
  entryQuantity: number;
  entryNotes: string;
  /** Foto e instrução de contagem do cadastro do produto; ausentes quando não cadastradas. */
  imageUrl?: string | null;
  countingInstruction?: string | null;
};
export type CountSession = { id: string; kioskId: string; kioskName: string; status: string; startedAt: string; items: CountItem[] };
export type CountContext = {
  units: Array<{ id: string; name: string }>;
  openSessions: Array<{ id: string; kioskId: string; kioskName: string; startedAt: string; itemCount: number }>;
  exitReasons: Array<{ value: CountExitReason; label: string }>;
};
/** O que o operador digitou para um lote; texto, para não brigar com a digitação de decimais. */
export type CountDraft = { exit: string; reason: CountExitReason; exitNotes: string; entry: string; entryNotes: string };
export type CountDrafts = Record<string, CountDraft>;

export const DEFAULT_EXIT_REASON = "SAIDA_CONSUMO";
export const OTHER_EXIT_REASON = "SAIDA_DESCARTE_OUTROS";

export const parseQuantity = (value: string) => {
  const number = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return value.trim() && Number.isFinite(number) && number >= 0 ? number : 0;
};
export const formatQuantity = (value: number) => String(Math.round(value * 1000) / 1000).replace(".", ",");

export function draftFromItem(item: CountItem): CountDraft {
  return {
    exit: item.exitQuantity ? formatQuantity(item.exitQuantity) : "",
    reason: item.exitReason || DEFAULT_EXIT_REASON,
    exitNotes: item.exitNotes ?? "",
    entry: item.entryQuantity ? formatQuantity(item.entryQuantity) : "",
    entryNotes: item.entryNotes ?? "",
  };
}

export function finalQuantity(item: CountItem, draft: CountDraft | undefined) {
  return draft ? item.systemQuantity - parseQuantity(draft.exit) + parseQuantity(draft.entry) : item.systemQuantity;
}

export function draftChanged(draft: CountDraft | undefined) {
  return !!draft && (parseQuantity(draft.exit) > 0 || parseQuantity(draft.entry) > 0);
}

export function loadCountContext(user: User) {
  return authenticatedJson<CountContext>(user, "/api/stock/mobile-count");
}

export function startCount(user: User, kioskId: string) {
  return authenticatedJson<{ session: CountSession; resumed: boolean }>(user, "/api/stock/mobile-count/start", { method: "POST", body: JSON.stringify({ kioskId }) });
}

export function saveCount(user: User, session: CountSession, drafts: CountDrafts, complete: boolean) {
  // Só os lotes com lançamento viajam; os demais ficam com a quantidade do sistema.
  const entries = session.items.flatMap((item) => {
    const draft = drafts[item.lotId];
    if (!draftChanged(draft)) return [];
    return [{
      lotId: item.lotId,
      exitQuantity: parseQuantity(draft!.exit), exitReason: draft!.reason, exitNotes: draft!.exitNotes.trim(),
      entryQuantity: parseQuantity(draft!.entry), entryNotes: draft!.entryNotes.trim(),
    }];
  });
  return authenticatedJson<{ status: string; alreadyCompleted: boolean; adjustedLots: number }>(
    user, "/api/stock/mobile-count/save", { method: "POST", body: JSON.stringify({ sessionId: session.id, entries, complete }) });
}

// Rascunho no aparelho: o estoque costuma ter sinal ruim, e nada digitado pode se perder por isso.
const DRAFT_DIRECTORY = `${FileSystem.documentDirectory ?? ""}coala-notas-count/`;
const draftPath = (sessionId: string) => `${DRAFT_DIRECTORY}${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

export async function loadLocalDrafts(sessionId: string): Promise<CountDrafts | null> {
  try {
    const value = JSON.parse(await FileSystem.readAsStringAsync(draftPath(sessionId))) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as CountDrafts : null;
  } catch {
    return null;
  }
}

export async function saveLocalDrafts(sessionId: string, drafts: CountDrafts) {
  if (!FileSystem.documentDirectory) return;
  await FileSystem.makeDirectoryAsync(DRAFT_DIRECTORY, { intermediates: true }).catch(() => undefined);
  await FileSystem.writeAsStringAsync(draftPath(sessionId), JSON.stringify(drafts)).catch(() => undefined);
}

export async function clearLocalDrafts(sessionId: string) {
  await FileSystem.deleteAsync(draftPath(sessionId), { idempotent: true }).catch(() => undefined);
}

export const simulationCountContext: CountContext = {
  units: [{ id: "simulation-unit", name: "Unidade de simulação" }],
  openSessions: [],
  exitReasons: [
    { value: "SAIDA_CONSUMO", label: "Venda/Consumo" },
    { value: "SAIDA_DESCARTE_VENCIMENTO", label: "Descarte por vencimento" },
    { value: "SAIDA_DESCARTE_AVARIA", label: "Avaria/Quebra" },
    { value: "SAIDA_DESCARTE_OUTROS", label: "Outros" },
  ],
};

export function createSimulationCountSession(): CountSession {
  const item = (lotId: string, productName: string, systemQuantity: number, displayUnit: string, expiryDate: string | null): CountItem => ({
    lotId, productName, lotNumber: "SIM-001", expiryDate, systemQuantity, displayUnit,
    exitQuantity: 0, exitReason: DEFAULT_EXIT_REASON, exitNotes: "", entryQuantity: 0, entryNotes: "",
  });
  return {
    id: "simulation-count", kioskId: "simulation-unit", kioskName: "Unidade de simulação", status: "pending_review", startedAt: new Date().toISOString(),
    items: [
      item("sim-1", "Leite integral (1L)", 12, "caixa", "2026-12-01"),
      item("sim-2", "Açúcar refinado (1kg)", 5, "pacote", null),
      item("sim-3", "Copo descartável 300 ml (100un)", 8, "pacote", null),
    ],
  };
}
