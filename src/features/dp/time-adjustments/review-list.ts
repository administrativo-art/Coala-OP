import type { SortDirection } from "@/components/patterns/sort-header";

import { ADJUSTMENT_KIND_LABELS, type AdjustmentView, type MarkingClassificationRequestView } from "./types";

export type ReviewRowKind = "adjustment" | "classification";
export type ReviewSortKey = "employee" | "request" | "day";
export type ReviewSort = { key: ReviewSortKey; direction: SortDirection };
export type ReviewFilters = { search: string; kind: ReviewRowKind | "all" };

/** Uma linha da fila de análise: pedido de ajuste ou de classificação, com os textos que a lista mostra. */
export type ReviewRow = {
  key: string;
  kind: ReviewRowKind;
  personId: string;
  employeeName: string;
  requestLabel: string;
  /** Pedido do ensaio (sem efeito fiscal): a lista o sinaliza com um selo, nunca só no texto. */
  pilot: boolean;
  workDate: string;
  source: { type: "adjustment"; item: AdjustmentView } | { type: "classification"; item: MarkingClassificationRequestView };
};

/** Sem acento e em minúsculas, para a busca e para casar nome com cadastro. */
export function normalizeReviewText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function formatWorkDate(workDate: string) {
  return workDate.split("-").reverse().join("/");
}

export function buildReviewRows(adjustments: AdjustmentView[], classifications: MarkingClassificationRequestView[]): ReviewRow[] {
  return [
    ...adjustments.map((item): ReviewRow => ({
      key: `adjustment:${item.id}`,
      kind: "adjustment",
      personId: item.employeeUid,
      employeeName: item.employeeName ?? "Titular",
      requestLabel: ADJUSTMENT_KIND_LABELS[item.kind].title,
      pilot: item.scope === "pilot",
      workDate: item.workDate,
      source: { type: "adjustment", item },
    })),
    ...classifications.map((item): ReviewRow => ({
      key: `classification:${item.id}`,
      kind: "classification",
      personId: item.employeeId,
      employeeName: item.employeeName ?? "Titular",
      requestLabel: "Classificação da batida",
      pilot: false,
      workDate: item.workDate,
      source: { type: "classification", item },
    })),
  ];
}

export function filterReviewRows(rows: ReviewRow[], filters: ReviewFilters): ReviewRow[] {
  const search = normalizeReviewText(filters.search);
  return rows.filter((row) => {
    if (filters.kind !== "all" && row.kind !== filters.kind) return false;
    if (!search) return true;
    return normalizeReviewText(`${row.employeeName} ${row.pilot ? "Simulação " : ""}${row.requestLabel}`).includes(search);
  });
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Ordena sem alterar a lista de entrada; empate resolve pelo nome e depois pela chave, para a ordem não pular. */
export function sortReviewRows(rows: ReviewRow[], sort: ReviewSort): ReviewRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const primary = (a: ReviewRow, b: ReviewRow) => {
    if (sort.key === "day") return a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0;
    if (sort.key === "request") return collator.compare(a.requestLabel, b.requestLabel);
    return collator.compare(a.employeeName, b.employeeName);
  };
  return [...rows].sort((a, b) => sign * primary(a, b) || collator.compare(a.employeeName, b.employeeName) || collator.compare(a.key, b.key));
}

/**
 * Clique no título: outra coluna começa pelo caso mais útil (dia: mais recente primeiro; texto: A a Z);
 * a mesma coluna inverte a ordem.
 */
export function nextReviewSort(current: ReviewSort, key: ReviewSortKey): ReviewSort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: key === "day" ? "desc" : "asc" };
}
