export type AsoControlSummary = {
  records?: Array<{
    type?: string;
    examDate?: string;
    fitnessStatus?: string | null;
    documentTypeCode?: string | null;
  }>;
  admissionMissing?: boolean;
  lastValidExamDate?: string | null;
  nextPeriodicDue?: string | null;
  status?: string;
  periodicityMonths?: number;
};

export type AsoPanelRecord = NonNullable<AsoControlSummary["records"]>[number] & {
  source?: "summary" | "legacy_field";
};

export function asoTypeLabel(type?: string) {
  if (type === "admission") return "Admissional";
  if (type === "periodic") return "Periódico";
  if (type === "return") return "Retorno";
  if (type === "risk_change") return "Mudança de risco/função";
  if (type === "dismissal") return "Demissional";
  return "ASO";
}

export function asoStatus(summary: AsoControlSummary | null, hasLegacyAdmission = false) {
  if (!summary || summary.admissionMissing || summary.status === "missing_admission") {
    if (hasLegacyAdmission) return { label: "ASO antigo a confirmar", tone: "warn" as const };
    return { label: "ASO admissional pendente", tone: "bad" as const };
  }
  if (summary.status === "overdue") return { label: "Periódico vencido", tone: "bad" as const };
  if (summary.status === "due_soon") return { label: "Periódico próximo", tone: "warn" as const };
  if (summary.status === "dismissal_recorded") return { label: "Demissional registrado", tone: "default" as const };
  return { label: "Em dia", tone: "good" as const };
}

export function asoRecordKey(record: Pick<AsoPanelRecord, "type" | "examDate">) {
  return `${record.type ?? ""}|${record.examDate ?? ""}`;
}
