import { z } from "zod";

/**
 * Ocorrência de taxa: nasce quando o operador contesta um item na aba Taxas e acompanha a conversa com a
 * Stone (contatos e protocolo) até o resultado. O dado da Stone nunca é alterado; a ocorrência só registra o acompanhamento.
 */
export const OCCURRENCE_MAX_CONTACTS = 50;

export const OCCURRENCE_REASONS = {
  above_contract: "Taxa acima da contratada",
  unexpected_charge: "Cobrança sem motivo conhecido",
  wrong_rate_period: "Taxa aplicada fora da vigência",
  other: "Outro motivo",
} as const;
export type FeeOccurrenceReason = keyof typeof OCCURRENCE_REASONS;

export const OCCURRENCE_CHANNELS = { phone: "Central de atendimento", chat: "Chat ou aplicativo", email: "E-mail", account_manager: "Gerente de contas" } as const;
export type FeeOccurrenceChannel = keyof typeof OCCURRENCE_CHANNELS;

export const OCCURRENCE_OUTCOMES = { refunded: "A Stone devolveu o valor", kept: "A Stone manteve a cobrança (aceitar)", cancelled: "Cancelada pelo operador" } as const;
export type FeeOccurrenceOutcome = keyof typeof OCCURRENCE_OUTCOMES;

export type FeeOccurrenceKind = "sale_fee" | "rate_change" | "other_charge";
export type FeeOccurrenceStatus = "open" | "in_progress" | "closed";

export type FeeOccurrenceContact = { at: string; contactDate: string; channel: FeeOccurrenceChannel; protocol: string | null; note: string | null; actorId: string };
export type FeeOccurrence = {
  id: string; kind: FeeOccurrenceKind; itemKey: string; label: string; detail: string | null; itemDate: string | null; amountCents: number; month: string;
  reason: FeeOccurrenceReason | null; protocol: string | null; note: string | null;
  openedAt: string; openedBy: string; contacts: FeeOccurrenceContact[];
  status: FeeOccurrenceStatus; closedAt: string | null; closedBy: string | null;
  outcome: FeeOccurrenceOutcome | null; refundedCents: number | null; resolvedOn: string | null; closeNote: string | null;
};

/** Aberta: sem contato. Em andamento: com contato e sem resultado. Finalizada: com resultado. */
export function occurrenceStatus(input: { contacts: unknown[]; outcome: string | null }): FeeOccurrenceStatus {
  if (input.outcome) return "closed";
  return input.contacts.length ? "in_progress" : "open";
}

export const OCCURRENCE_CATEGORY: Record<FeeOccurrenceKind, string> = { rate_change: "Nova taxa", sale_fee: "Fora do padrão", other_charge: "Cobrança extra" };

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value, "Data inválida.");
export const protocolSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/, "Protocolo inválido: use de 3 a 40 letras, números, ponto, barra ou hífen.");
const reasonSchema = z.enum(Object.keys(OCCURRENCE_REASONS) as [FeeOccurrenceReason, ...FeeOccurrenceReason[]]);
const channelSchema = z.enum(Object.keys(OCCURRENCE_CHANNELS) as [FeeOccurrenceChannel, ...FeeOccurrenceChannel[]]);
const outcomeSchema = z.enum(Object.keys(OCCURRENCE_OUTCOMES) as [FeeOccurrenceOutcome, ...FeeOccurrenceOutcome[]]);

/** Motivo e protocolo (opcional) que acompanham a contestação. */
export const contestDetailsSchema = { reason: reasonSchema.optional(), protocol: protocolSchema.optional() };

export const feeOccurrenceActionSchema = z.object({
  kioskId: z.string().trim().min(1).max(180),
  stoneCode: z.string().regex(/^\d{1,20}$/),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  occurrenceId: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["contact", "close"]),
  contactDate: isoDay.optional(),
  channel: channelSchema.optional(),
  protocol: protocolSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
  outcome: outcomeSchema.optional(),
  refundedCents: z.number().int().min(1).max(100_000_000_00).optional(),
  resolvedOn: isoDay.optional(),
}).strict().superRefine((value, context) => {
  const need = (field: keyof typeof value, message: string) => { if (value[field] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message }); };
  const forbid = (field: keyof typeof value) => { if (value[field] !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Campo incompatível com a ação." }); };
  if (value.action === "contact") {
    need("contactDate", "Informe a data do contato."); need("channel", "Informe o canal.");
    (["outcome", "refundedCents", "resolvedOn"] as const).forEach(forbid);
    return;
  }
  need("outcome", "Informe o resultado."); need("resolvedOn", "Informe a data da resposta.");
  forbid("contactDate"); forbid("channel");
  if (value.outcome === "refunded" && value.refundedCents === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["refundedCents"], message: "Informe o valor devolvido." });
  if (value.outcome !== "refunded" && value.refundedCents !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["refundedCents"], message: "Valor devolvido só vale quando a Stone devolveu." });
});
export type FeeOccurrenceActionInput = z.infer<typeof feeOccurrenceActionSchema>;

export const isOccurrenceAction = (value: unknown): value is { action: string } => typeof value === "object" && value !== null && "action" in value;

/** Atualiza a ocorrência com um contato ou com o resultado; devolve o novo estado ou o motivo da recusa. */
export function applyOccurrenceAction(
  occurrence: Pick<FeeOccurrence, "contacts" | "protocol" | "status">,
  input: FeeOccurrenceActionInput, actorId: string, now: Date,
): { ok: true; contacts: FeeOccurrenceContact[]; protocol: string | null; closed: null | { outcome: FeeOccurrenceOutcome; refundedCents: number | null; resolvedOn: string; note: string | null } }
  | { ok: false; code: "CLOSED" | "TOO_MANY_CONTACTS" | "PROTOCOL_REQUIRED" } {
  if (occurrence.status === "closed") return { ok: false, code: "CLOSED" };
  const protocol = input.protocol ?? occurrence.protocol;
  if (input.action === "contact") {
    if (occurrence.contacts.length >= OCCURRENCE_MAX_CONTACTS) return { ok: false, code: "TOO_MANY_CONTACTS" };
    const contact: FeeOccurrenceContact = { at: now.toISOString(), contactDate: input.contactDate!, channel: input.channel!, protocol: input.protocol ?? null, note: input.note ?? null, actorId };
    return { ok: true, contacts: [...occurrence.contacts, contact], protocol, closed: null };
  }
  if (!protocol) return { ok: false, code: "PROTOCOL_REQUIRED" };
  return { ok: true, contacts: occurrence.contacts, protocol, closed: { outcome: input.outcome!, refundedCents: input.refundedCents ?? null, resolvedOn: input.resolvedOn!, note: input.note ?? null } };
}
