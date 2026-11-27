import type { AbsenceRequestRecord } from "@/features/dp/absences/requests/workflow-types";

import { buildMonthView, type DayAbsence, type DayMarking, type DayShift, type DayTreatment, type DayView } from "./day-model";
import { repPDateInZone } from "./time-zones";

/**
 * Contrato central do dia (plano de turno de cobertura, etapa 2): o servidor monta o resumo de cada dia do mês
 * com as mesmas regras de `day-model.ts` e o entrega pronto; web e Coala Go só exibem. Mudar a regra do dia exige
 * subir a versão, para que pedidos de revisão e conferências saibam com qual cálculo o resultado foi produzido.
 */
export const DAY_ALGORITHM_VERSION = 3;

/** Fuso do negócio para "hoje" no servidor; o mesmo da falta automática. */
export const BUSINESS_TIME_ZONE = "America/Fortaleza";

export type MonthDays = { month: string; today: string; algorithmVersion: number; days: DayView[] };

/** Data civil de hoje no fuso do negócio; o servidor nunca usa a data UTC para decidir se um dia já passou. */
export function businessToday(now = new Date()) {
  return repPDateInZone(BUSINESS_TIME_ZONE, now);
}

export function assembleMonthDays(input: {
  month: string;
  today: string;
  shifts: (DayShift & { date: string })[];
  markings: (DayMarking & { workDate: string })[];
  absences: DayAbsence[];
  treatments?: DayTreatment[];
}): MonthDays {
  return {
    month: input.month,
    today: input.today,
    algorithmVersion: DAY_ALGORITHM_VERSION,
    days: buildMonthView(input),
  };
}

/** Ausências que valem no mês: aprovadas, em análise ou enviadas; rascunho, recusada e cancelada não contam. */
export function monthAbsencesOf(records: AbsenceRequestRecord[], startDate: string): DayAbsence[] {
  return records
    .filter((record) => record.endDate >= startDate && !["draft", "cancelled", "rejected"].includes(record.status))
    .map((record) => ({
      id: record.id,
      typeName: record.typeSnapshot?.name ?? record.typeId,
      status: record.status,
      startDate: record.startDate,
      endDate: record.endDate,
      approvedByInaction: record.approvalOrigin === "tacit_timeout",
    }));
}
