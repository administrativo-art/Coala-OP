export type ImageVoiceConsentStatus = "granted" | "denied" | "revoked";
export type ConsentOperationalEffectStatus =
  | "not_applicable"
  | "pending"
  | "in_progress"
  | "completed";

export type ImageVoiceUsage = {
  usageId: string;
  channel: string;
  asset: string;
  publishedAt: string;
  registeredAt: string;
  registeredBy: string;
  removedAt: string | null;
  removedBy: string | null;
};

export type ImageVoiceConsentState = {
  status: ImageVoiceConsentStatus;
  termVersion: string;
  termHash: string;
  decisionAt: string;
  decisionChannel: string;
  decisionEvidence: Record<string, unknown>;
  signedDocumentId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  revocationChannel: string | null;
  operationalEffectStatus: ConsentOperationalEffectStatus;
  operationalEffectAt: string | null;
  usages: ImageVoiceUsage[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeImageVoiceConsent(value: unknown): ImageVoiceConsentState {
  const source = record(value);
  const authorized = source.autorizado === true;
  const explicitStatus = text(source.status);
  const status: ImageVoiceConsentStatus =
    explicitStatus === "granted" || explicitStatus === "denied" || explicitStatus === "revoked"
      ? explicitStatus
      : text(source.revokedAt) || text(source.revogado_em)
        ? "revoked"
        : authorized
          ? "granted"
          : "denied";
  const rawUsages = Array.isArray(source.usages) ? source.usages : [];
  const usages = rawUsages.map((entry) => {
    const usage = record(entry);
    return {
      usageId: text(usage.usageId),
      channel: text(usage.channel),
      asset: text(usage.asset),
      publishedAt: text(usage.publishedAt),
      registeredAt: text(usage.registeredAt),
      registeredBy: text(usage.registeredBy),
      removedAt: text(usage.removedAt) || null,
      removedBy: text(usage.removedBy) || null,
    };
  }).filter((entry) => entry.usageId && entry.channel && entry.asset);
  const operationalStatus = text(source.operationalEffectStatus);

  return {
    status,
    termVersion: text(source.termVersion) || text(source.versao_termo),
    termHash: text(source.termHash) || text(source.hash_termo_exibido),
    decisionAt: text(source.decisionAt) || text(source.respondido_em),
    decisionChannel: text(source.decisionChannel) || text(source.origem) || "legacy",
    decisionEvidence: record(source.decisionEvidence),
    signedDocumentId: text(source.signedDocumentId) || null,
    revokedAt: text(source.revokedAt) || text(source.revogado_em) || null,
    revocationReason: text(source.revocationReason) || text(source.motivo_revogacao) || null,
    revocationChannel: text(source.revocationChannel) || null,
    operationalEffectStatus:
      operationalStatus === "pending"
      || operationalStatus === "in_progress"
      || operationalStatus === "completed"
        ? operationalStatus
        : status === "revoked"
          ? "pending"
          : "not_applicable",
    operationalEffectAt: text(source.operationalEffectAt) || null,
    usages,
  };
}

export function revokeImageVoiceConsent(
  value: unknown,
  input: { at: string; channel: string; reason?: string | null },
): ImageVoiceConsentState {
  const current = normalizeImageVoiceConsent(value);
  if (current.status !== "granted") {
    throw new Error("A autorização de imagem e voz já está revogada ou não foi concedida.");
  }
  return {
    ...current,
    status: "revoked",
    revokedAt: input.at,
    revocationReason: text(input.reason) || null,
    revocationChannel: text(input.channel) || "unknown",
    operationalEffectStatus: current.usages.some((usage) => !usage.removedAt)
      ? "pending"
      : "completed",
    operationalEffectAt: current.usages.some((usage) => !usage.removedAt)
      ? null
      : input.at,
  };
}

export function registerImageVoiceUsage(
  value: unknown,
  input: Omit<ImageVoiceUsage, "removedAt" | "removedBy">,
): ImageVoiceConsentState {
  const current = normalizeImageVoiceConsent(value);
  if (current.status !== "granted") {
    throw new Error("Não é permitido registrar novo uso sem autorização vigente.");
  }
  if (!input.usageId.trim() || !input.channel.trim() || !input.asset.trim()) {
    throw new Error("Uso, canal e ativo são obrigatórios.");
  }
  if (current.usages.some((usage) => usage.usageId === input.usageId)) return current;
  if (current.usages.length >= 100) {
    throw new Error("O inventário em linha atingiu o limite; arquive usos antigos antes de continuar.");
  }
  return {
    ...current,
    usages: [...current.usages, { ...input, removedAt: null, removedBy: null }],
  };
}

export function markImageVoiceUsageRemoved(
  value: unknown,
  input: { usageId: string; removedAt: string; removedBy: string },
): ImageVoiceConsentState {
  const current = normalizeImageVoiceConsent(value);
  let found = false;
  const usages = current.usages.map((usage) => {
    if (usage.usageId !== input.usageId) return usage;
    found = true;
    return { ...usage, removedAt: input.removedAt, removedBy: input.removedBy };
  });
  if (!found) throw new Error("Uso de imagem ou voz não encontrado.");
  const completed = current.status === "revoked" && usages.every((usage) => usage.removedAt);
  return {
    ...current,
    usages,
    operationalEffectStatus: completed ? "completed" : current.operationalEffectStatus,
    operationalEffectAt: completed ? input.removedAt : current.operationalEffectAt,
  };
}
