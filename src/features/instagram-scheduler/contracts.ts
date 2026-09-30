import { z } from "zod";

export const instagramPublicationFormats = [
  "feed_image",
  "carousel",
  "reel",
  "story",
] as const;

export const instagramPublicationStatuses = [
  "uploading",
  "scheduled",
  "processing",
  "published",
  "failed",
  "manual_review",
  "cancelled",
] as const;

export type InstagramPublicationFormat = (typeof instagramPublicationFormats)[number];
export type InstagramPublicationStatus = (typeof instagramPublicationStatuses)[number];

export const instagramMediaInputSchema = z.object({
  localPath: z.string().min(1),
  kind: z.enum(["image", "video"]),
  contentType: z.string().min(1),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const instagramScheduleInputSchema = z
  .object({
    format: z.enum(instagramPublicationFormats),
    scheduledAt: z.string().datetime({ offset: true }),
    caption: z.string().max(2_200).default(""),
    media: z.array(instagramMediaInputSchema).min(1).max(10),
    shareToFeed: z.boolean().default(true),
    storyMentions: z.array(
      z.string()
        .trim()
        .transform((value) => value.replace(/^@/, ""))
        .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Usuário do Instagram inválido.")),
    ).max(20).default([]),
    location: z
      .object({
        id: z.string().regex(/^\d+$/, "A localização deve usar um ID numérico da Meta."),
        name: z.string().min(1).max(160),
      })
      .optional(),
  })
  .superRefine((input, context) => {
    const images = input.media.filter((item) => item.kind === "image").length;
    const videos = input.media.filter((item) => item.kind === "video").length;

    if (["feed_image", "carousel"].includes(input.format)) {
      input.media.forEach((item, index) => {
        if (item.kind !== "image" || !item.width || !item.height) return;
        const ratio = item.width / item.height;
        if (ratio < 0.8 || ratio > 1.91) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["media", index],
            message: "A imagem do feed deve ter proporção entre 4:5 e 1,91:1.",
          });
        }
      });
    }

    if (input.format === "feed_image" && (input.media.length !== 1 || images !== 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "Uma publicação de feed exige exatamente uma imagem JPEG.",
      });
    }

    if (input.format === "carousel" && (input.media.length < 2 || input.media.length > 10)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "Um carrossel exige de 2 a 10 mídias.",
      });
    }

    if (input.format === "reel" && (input.media.length !== 1 || videos !== 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "Um reel exige exatamente um vídeo.",
      });
    }

    if (input.format === "story" && (input.media.length < 1 || input.media.length > 10)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "Uma sequência de Stories aceita de 1 a 10 mídias.",
      });
    }

    if (input.format !== "story" && input.storyMentions.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storyMentions"],
        message: "Menções invisíveis estão disponíveis somente para Stories.",
      });
    }
  });

export type InstagramScheduleInput = z.infer<typeof instagramScheduleInputSchema>;

const instagramScheduleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Agendamento inválido.");

const instagramScheduleUpdateSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  mediaOrder: z.array(z.number().int().nonnegative()).min(1).max(10).optional(),
}).strict().refine(
  (value) => value.scheduledAt !== undefined || value.mediaOrder !== undefined,
  "Informe ao menos uma alteração.",
);

export const instagramScheduleMutationSchema = z.union([
  instagramScheduleUpdateSchema,
  z.object({
    swapWithId: instagramScheduleIdSchema,
  }).strict(),
]);

export type InstagramScheduleMutation = z.infer<typeof instagramScheduleMutationSchema>;

export const instagramMediaLibraryKinds = ["image", "video"] as const;
export type InstagramMediaLibraryKind = (typeof instagramMediaLibraryKinds)[number];

export const instagramMediaLibraryFolderSchema = z
  .string()
  .trim()
  .min(1, "Informe uma pasta.")
  .max(80, "A pasta deve ter até 80 caracteres.")
  .regex(/^[^/\\\u0000-\u001f]+$/, "Nome de pasta inválido.");

export type InstagramMediaLibraryItem = {
  id: string;
  fileName: string;
  folder: string;
  kind: InstagramMediaLibraryKind;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  previewUrl: string;
  createdAt: string;
};

export type InstagramScheduleListItem = {
  id: string;
  format: InstagramPublicationFormat;
  status: InstagramPublicationStatus;
  scheduledAt: string;
  caption: string;
  media: Array<{
    kind: "image" | "video";
    fileName: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    previewUrl: string | null;
  }>;
  shareToFeed: boolean;
  storyMentions: string[];
  location: { id: string; name: string } | null;
  attempts: number;
  publishedAt: string | null;
  permalink: string | null;
  safeError: string | null;
  errorEventId: string | null;
  createdAt: string;
};

export type InstagramPublishedFeedItem = {
  id: string;
  format: Exclude<InstagramPublicationFormat, "story">;
  caption: string;
  previewUrl: string;
  permalink: string;
  publishedAt: string;
  childrenCount: number;
};

export type InstagramPublishedFeedProfile = {
  username: string;
  profilePictureUrl: string | null;
};

export const instagramFormatLabels: Record<InstagramPublicationFormat, string> = {
  feed_image: "Feed",
  carousel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

export const instagramStatusLabels: Record<InstagramPublicationStatus, string> = {
  uploading: "Enviando mídia",
  scheduled: "Programada",
  processing: "Publicando",
  published: "Publicada",
  failed: "Falhou",
  manual_review: "Revisão necessária",
  cancelled: "Cancelada",
};
