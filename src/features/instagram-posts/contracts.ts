import { z } from "zod";

import { instagramPublicationFormats } from "@/features/instagram-scheduler/contracts";

export const instagramEditorialStatuses = ["planned", "produced", "scheduled", "published"] as const;
export const instagramApprovalStatuses = ["pending", "approved"] as const;
export const instagramPublicationModes = ["automatic", "manual"] as const;

export type InstagramEditorialStatus = (typeof instagramEditorialStatuses)[number];
export type InstagramApprovalStatus = (typeof instagramApprovalStatuses)[number];

const cleanText = z.string().trim();

function safePath(value: string) {
  const segments = value.split("/");
  return value.length <= 700
    && !value.startsWith("/")
    && !value.endsWith("/")
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !/[\\\u0000-\u001f]/.test(segment));
}

export const instagramCampaignPathSchema = cleanText
  .min(1)
  .refine(safePath, "Caminho de campanha inválido.")
  .refine(
    (value) => /^03 - Campanhas\/(01 - Planejamento|02 - Ativo|03 - Arquivado)\/[^/]+$/.test(value),
    "A campanha deve apontar para uma pasta oficial de 03 - Campanhas.",
  );

export const instagramPostPlacementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("campaign"),
    campaignPath: instagramCampaignPathSchema,
  }).strict(),
  z.object({
    kind: z.literal("editorial"),
  }).strict(),
]);

export const instagramPostObjectives = ["awareness", "engagement", "sales", "relationship", "institutional"] as const;
export type InstagramPostObjective = (typeof instagramPostObjectives)[number];

/** Mínimo de caracteres de cada motivo para concluir o planejamento (marcar como Produzido). */
export const INSTAGRAM_PLANNING_MIN_RATIONALE = 20;

/**
 * Planejamento editorial: o porquê da arte e do formato e a estratégia de publicação.
 * Não entra no hash do conteúdo aprovado; alterar depois da aprovação apenas sinaliza a mudança.
 * `plannedAt` é intenção; o agendamento real continua exigindo a autorização explícita.
 */
export const instagramPostPlanningSchema = z.object({
  designRationale: cleanText.max(1_000),
  formatRationale: cleanText.max(1_000),
  objective: z.enum(instagramPostObjectives).nullable(),
  callToAction: cleanText.max(200),
  plannedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const instagramPostPlanningPatchSchema = instagramPostPlanningSchema.partial().strict();

export const instagramPostCreateSchema = z.object({
  clientMutationId: z.string().uuid("Identificador idempotente inválido."),
  title: cleanText.min(1).max(120),
  format: z.enum(instagramPublicationFormats),
  status: z.literal("planned").default("planned"),
  placement: instagramPostPlacementSchema,
  direction: cleanText.max(20_000).default(""),
  caption: z.string().max(2_200).default(""),
  shareToFeed: z.boolean().default(true),
  storyMentions: z.array(cleanText.regex(/^[A-Za-z0-9._]{1,30}$/)).max(20).default([]),
  publicationMode: z.enum(instagramPublicationModes).default("automatic"),
  manualInstructions: cleanText.max(2_000).default(""),
  planning: instagramPostPlanningPatchSchema.optional(),
}).strict();

export const instagramPostUpdateSchema = z.object({
  status: z.enum(["planned", "produced"]).optional(),
  direction: cleanText.max(20_000).optional(),
  caption: z.string().max(2_200).optional(),
  shareToFeed: z.boolean().optional(),
  storyMentions: z.array(cleanText.regex(/^[A-Za-z0-9._]{1,30}$/)).max(20).optional(),
  publicationMode: z.enum(instagramPublicationModes).optional(),
  manualInstructions: cleanText.max(2_000).optional(),
  planning: instagramPostPlanningPatchSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.");

const explicitAuthorizationSchema = z.object({
  confirmation: z.string().min(1).max(500),
  statement: z.string().trim().min(8).max(500),
}).strict();

export const instagramPostActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_content"), authorization: explicitAuthorizationSchema }).strict(),
  z.object({ action: z.literal("approve_publication"), authorization: explicitAuthorizationSchema }).strict(),
  z.object({
    action: z.literal("schedule"),
    scheduledAt: z.string().datetime({ offset: true }),
    timezone: z.literal("America/Belem").default("America/Belem"),
    authorization: explicitAuthorizationSchema,
  }).strict(),
  z.object({ action: z.literal("publish"), authorization: explicitAuthorizationSchema }).strict(),
  z.object({ action: z.literal("cancel"), authorization: explicitAuthorizationSchema }).strict(),
]);

export type InstagramPostCreateInput = z.infer<typeof instagramPostCreateSchema>;
export type InstagramPostUpdateInput = z.infer<typeof instagramPostUpdateSchema>;
export type InstagramPostActionInput = z.infer<typeof instagramPostActionSchema>;

export type InstagramEditorialPost = {
  id: string;
  title: string;
  format: InstagramPostCreateInput["format"];
  status: InstagramEditorialStatus;
  approvalStatus: InstagramApprovalStatus;
  placement: InstagramPostCreateInput["placement"] | null;
  folderPath: string;
  direction: string;
  caption: string;
  shareToFeed: boolean;
  storyMentions: string[];
  publicationMode: "automatic" | "manual";
  manualInstructions: string;
  planning: {
    designRationale: string;
    formatRationale: string;
    objective: InstagramPostObjective | null;
    callToAction: string;
    plannedAt: string | null;
    updatedAt: string | null;
  };
  media: Array<{
    id: string;
    kind: "image" | "video";
    fileName: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    previewUrl: string | null;
  }>;
  publicationReadiness: {
    status: "certified" | "blocked";
    rulesVersion: string;
    issues: Array<{ code: string; mediaIndex: number | null; message: string }>;
  };
  contentHash: string;
  contentApproval: { status: InstagramApprovalStatus; artifactSha256: string | null; approvedAt: string | null } | null;
  publicationApproval: { status: InstagramApprovalStatus; artifactSha256: string | null; approvedAt: string | null } | null;
  schedule: { at: string | null; timezone: string; scheduleId: string | null; mode: "automatic" | "manual" } | null;
  manualReminder: { status: "due"; notifiedAt: string | null; instructions: string } | null;
  publicationResult: {
    instagramMediaId: string | null;
    instagramMediaIds: string[];
    permalink: string | null;
    publishedAt: string | null;
    status: string | null;
    safeError: string | null;
  } | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function folderLabel(title: string) {
  return title
    .normalize("NFC")
    .replace(/[/:\\\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Post";
}

function formatFolder(format: InstagramPostCreateInput["format"]) {
  if (format === "reel") return "Reels";
  if (format === "story") return "Stories";
  return "Feed";
}

export function buildInstagramPostFolderPath(
  id: string,
  input: Pick<InstagramPostCreateInput, "title" | "format" | "placement">,
) {
  const leaf = `${id} · ${folderLabel(input.title)}`;
  return input.placement.kind === "campaign"
    ? `${input.placement.campaignPath.normalize("NFC")}/03 - Instagram/${formatFolder(input.format)}/${leaf}`
    : `09 - Instagram/02 - Editoriais/Posts/${leaf}`;
}

export function expectedInstagramPostConfirmation(input: {
  action: InstagramPostActionInput["action"];
  postId: string;
  contentHash: string;
  scheduledAt?: string;
}) {
  if (input.action === "approve_content") return `APPROVE-CONTENT:${input.postId}:${input.contentHash}`;
  if (input.action === "approve_publication") return `APPROVE-PUBLICATION:${input.postId}:${input.contentHash}`;
  if (input.action === "schedule") return `SCHEDULE:${input.postId}:${input.contentHash}:${input.scheduledAt}`;
  if (input.action === "publish") return `PUBLISH:${input.postId}:${input.contentHash}`;
  return `CANCEL:${input.postId}`;
}
