/** Lógica pura do planejamento editorial e das etapas do post (testada em tests/unit/instagram-post-planning.test.ts). */

import { INSTAGRAM_PLANNING_MIN_RATIONALE, type InstagramEditorialPost, type InstagramPostObjective } from "./contracts";

export const TIME_ZONE = "America/Belem";

export const POST_STEPS = ["planning", "approval", "publication", "result"] as const;
export type PostStep = (typeof POST_STEPS)[number];

export const STEP_LABELS: Record<PostStep, string> = {
  planning: "Planejamento editorial",
  approval: "Aprovação",
  publication: "Publicação",
  result: "Resultado",
};

export const OBJECTIVE_LABELS: Record<InstagramPostObjective, string> = {
  awareness: "Awareness (ser visto)",
  engagement: "Engajamento",
  sales: "Vendas",
  relationship: "Relacionamento",
  institutional: "Institucional",
};

type PostLike = Pick<InstagramEditorialPost, "status" | "contentHash" | "contentApproval" | "publicationApproval">;

export function approvalIsValid(post: PostLike, field: "contentApproval" | "publicationApproval") {
  const value = post[field];
  return value?.status === "approved" && value.artifactSha256 === post.contentHash;
}

export function fullyApproved(post: PostLike) {
  return approvalIsValid(post, "contentApproval") && approvalIsValid(post, "publicationApproval");
}

/** Etapa liberada: o planejamento é sempre editável; as seguintes dependem do estado e das aprovações. */
export function stepUnlocked(post: PostLike, step: PostStep) {
  if (step === "planning") return true;
  if (step === "approval") return post.status !== "planned";
  if (step === "publication") return post.status === "scheduled" || post.status === "published" || (post.status === "produced" && fullyApproved(post));
  return post.status === "scheduled" || post.status === "published";
}

/** Etapa em que o painel abre: a próxima pendência do post. */
export function initialStep(post: PostLike): PostStep {
  if (post.status === "planned") return "planning";
  if (post.status === "produced") return fullyApproved(post) ? "publication" : "approval";
  return "result";
}

export function stepDone(post: PostLike, step: PostStep) {
  if (step === "planning") return post.status !== "planned";
  if (step === "approval") return post.status !== "planned" && fullyApproved(post);
  if (step === "publication") return post.status === "scheduled" || post.status === "published";
  return post.status === "published";
}

export type PlanningFields = {
  designRationale: string;
  formatRationale: string;
  objective: InstagramPostObjective | null;
  callToAction: string;
  plannedAt: string | null;
};

export function rationaleValid(value: string) {
  return value.trim().length >= INSTAGRAM_PLANNING_MIN_RATIONALE;
}

export function planningComplete(planning: Pick<PlanningFields, "designRationale" | "formatRationale">) {
  return rationaleValid(planning.designRationale) && rationaleValid(planning.formatRationale);
}

export type ChecklistItem = { id: string; label: string; ok: boolean; required: boolean };

/** Itens conferidos antes de aprovar; os obrigatórios bloqueiam a aprovação na tela. */
export function approvalChecklist(post: Pick<InstagramEditorialPost, "format" | "caption" | "media" | "publicationReadiness" | "planning" | "schedule">): ChecklistItem[] {
  return [
    { id: "media", label: "Mídia certificada para o formato", ok: post.media.length > 0 && post.publicationReadiness.status === "certified", required: true },
    { id: "caption", label: "Legenda preenchida", ok: post.format === "story" || post.caption.trim().length > 0, required: true },
    { id: "design", label: "Motivo da arte e do design explicado", ok: rationaleValid(post.planning.designRationale), required: true },
    { id: "format", label: "Motivo do formato explicado", ok: rationaleValid(post.planning.formatRationale), required: true },
    { id: "date", label: "Data e hora alvo definidas", ok: Boolean(post.planning.plannedAt) || Boolean(post.schedule?.at), required: false },
  ];
}

export function approvalBlocked(items: ChecklistItem[]) {
  return items.some((item) => item.required && !item.ok);
}

/** O planejamento foi editado depois da aprovação de conteúdo (sem invalidá-la). */
export function planningChangedAfterApproval(post: Pick<InstagramEditorialPost, "contentApproval" | "planning">) {
  const approvedAt = post.contentApproval?.approvedAt;
  const updatedAt = post.planning.updatedAt;
  if (!approvedAt || !updatedAt) return false;
  return new Date(updatedAt).getTime() > new Date(approvedAt).getTime();
}

export function belemDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts;
}

function belemMinutes(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Quando o post ocupa a agenda: o agendamento confirmado vale mais do que a data planejada. */
export function effectiveDate(post: Pick<InstagramEditorialPost, "schedule" | "planning" | "publicationResult">): string | null {
  return post.publicationResult?.publishedAt ?? post.schedule?.at ?? post.planning.plannedAt ?? null;
}

export type PlanningWarning = { id: string; message: string };

/**
 * Avisos de estratégia para a data alvo: mesmo dia, horário próximo, formato repetido em sequência e data passada.
 * `others` são os demais posts do registro editorial (o próprio post é ignorado).
 */
export function planningWarnings(input: {
  postId: string;
  format: InstagramEditorialPost["format"];
  plannedAt: string | null;
  others: Array<Pick<InstagramEditorialPost, "id" | "format" | "schedule" | "planning" | "publicationResult">>;
  now?: Date;
}): PlanningWarning[] {
  if (!input.plannedAt) return [];
  const warnings: PlanningWarning[] = [];
  const target = new Date(input.plannedAt);
  if (Number.isNaN(target.getTime())) return [];
  const now = input.now ?? new Date();
  if (target.getTime() < now.getTime()) warnings.push({ id: "past", message: "A data alvo já passou." });

  const dayKey = belemDateKey(target);
  const targetMinutes = belemMinutes(input.plannedAt);
  const peers = input.others
    .filter((post) => post.id !== input.postId)
    .map((post) => ({ post, at: effectiveDate(post) }))
    .filter((entry): entry is { post: (typeof input.others)[number]; at: string } => entry.at !== null);

  const sameDay = peers.filter((entry) => belemDateKey(entry.at) === dayKey);
  if (sameDay.length >= 2) warnings.push({ id: "busy-day", message: `Já há ${sameDay.length} posts nesse dia.` });
  else if (sameDay.length === 1) warnings.push({ id: "busy-day", message: "Já há 1 post nesse dia." });

  const closeBy = sameDay.filter((entry) => Math.abs(belemMinutes(entry.at) - targetMinutes) < 60);
  if (closeBy.length > 0) warnings.push({ id: "same-hour", message: "Há outro post com menos de 1 hora de diferença." });

  const ordered = [...peers.map((entry) => ({ at: entry.at, format: entry.post.format })), { at: input.plannedAt, format: input.format }]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const position = ordered.findIndex((entry) => entry.at === input.plannedAt && entry.format === input.format);
  const same = (offset: number) => ordered[position + offset]?.format === input.format;
  if ((same(-1) && same(-2)) || (same(-1) && same(1)) || (same(1) && same(2))) {
    warnings.push({ id: "repeated-format", message: "Três posts do mesmo formato em sequência." });
  }
  return warnings;
}

/** Valor de `<input type="datetime-local">` (horário de Belém) a partir do ISO, e o caminho de volta. */
export function toBelemInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return parts.replace(" ", "T");
}

/** Belém não tem horário de verão: o deslocamento é fixo em -03:00. */
export function fromBelemInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
