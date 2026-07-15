import type { User } from "@/types";

export type TransportVoucherStatus = "none" | "active" | "suspended";
export type TransportVoucherHistoryEntry = NonNullable<User["transportVoucherHistory"]>[number];

type TransportVoucherChangedBy = {
  userId: string;
  username: string;
};

type ResolveTransportVoucherChangeInput = {
  fromStatus: TransportVoucherStatus;
  toStatus: "active" | "suspended";
  currentValue?: number | null;
  draftValue?: number | "" | null;
  effectiveDate: string;
  reason?: string;
  changedBy?: TransportVoucherChangedBy;
};

function newLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getTransportVoucherStatus(needsTransportVoucher: boolean | undefined, history?: User["transportVoucherHistory"]): TransportVoucherStatus {
  if (needsTransportVoucher) return "active";
  return history && history.length > 0 ? "suspended" : "none";
}

export function transportVoucherStatusLabel(status: TransportVoucherStatus) {
  if (status === "active") return "Ativo";
  if (status === "suspended") return "Suspenso";
  return "Não configurado";
}

export function formatTransportVoucherAction(entry: TransportVoucherHistoryEntry) {
  if (entry.toStatus === "suspended") return "Suspenso";
  return entry.fromStatus === "suspended" ? "Reativado" : "Solicitado";
}

export function defaultTransportVoucherReason(fromStatus: TransportVoucherStatus, toStatus: "active" | "suspended") {
  if (fromStatus === "none") return "Configuração inicial do vale-transporte.";
  if (toStatus === "active") return "Atualização do vale-transporte.";
  return "Suspensão do vale-transporte.";
}

function normalizeTransportVoucherValue(value: number | "" | null | undefined) {
  if (value === "" || value == null) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Informe um valor de vale-transporte válido.");
  }
  return value;
}

export function resolveTransportVoucherChange(input: ResolveTransportVoucherChangeInput) {
  const parsedValue = normalizeTransportVoucherValue(input.draftValue);
  const nextNeedsTransportVoucher = input.toStatus === "active";
  const nextTransportVoucherValue = nextNeedsTransportVoucher ? parsedValue : undefined;
  const changedStatus = input.fromStatus !== input.toStatus;
  const changedValue = (input.currentValue ?? undefined) !== parsedValue;
  const defaultReason = defaultTransportVoucherReason(input.fromStatus, input.toStatus);
  const explicitReason = input.reason?.trim();
  const reason = explicitReason || defaultReason;
  const hasCustomReason = Boolean(explicitReason && explicitReason !== defaultReason);
  const historyEntry: TransportVoucherHistoryEntry | null = changedStatus || changedValue || hasCustomReason
    ? {
        id: newLocalId("vt"),
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        effectiveDate: input.effectiveDate,
        reason,
        value: input.toStatus === "active" ? parsedValue : undefined,
        changedAt: new Date().toISOString(),
        changedBy: input.changedBy,
      }
    : null;

  return {
    nextNeedsTransportVoucher,
    nextTransportVoucherValue,
    historyEntry,
  };
}
