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
  "paused",
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
  z.object({
    cancel: z.literal(true),
  }).strict(),
  z.object({
    pause: z.literal(true),
  }).strict(),
  z.object({
    hide: z.literal(true),
  }).strict(),
  z.object({
    resume: z.literal(true),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
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

export const instagramMediaFolderIdSchema = z.string().uuid("Pasta inválida.");
export const instagramMediaFolderParentSchema = instagramMediaFolderIdSchema.nullable();

export const instagramMediaFolderCreateSchema = z.object({
  name: instagramMediaLibraryFolderSchema,
  parentId: instagramMediaFolderParentSchema,
}).strict();

export const instagramMediaFolderUpdateSchema = z.object({
  name: instagramMediaLibraryFolderSchema.optional(),
  parentId: instagramMediaFolderParentSchema.optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.parentId !== undefined,
  "Informe ao menos uma alteração.",
);

export const instagramMediaMoveSchema = z.object({
  ids: z.array(z.string().uuid("Mídia inválida.")).min(1).max(50),
  folderId: instagramMediaFolderParentSchema,
}).strict().refine(
  (value) => new Set(value.ids).size === value.ids.length,
  "Mídias repetidas.",
);

export type InstagramMediaFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type InstagramMediaLibraryItem = {
  id: string;
  fileName: string;
  folderId: string | null;
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

export const instagramInsightsDays = [7, 30, 90] as const;
export type InstagramInsightsDays = (typeof instagramInsightsDays)[number];
export const instagramInsightsPeriods = [...instagramInsightsDays, "year"] as const;
export type InstagramInsightsPeriod = (typeof instagramInsightsPeriods)[number];
export const instagramInsightsSections = ["overview", "results", "audience", "content", "ads"] as const;
export type InstagramInsightsSection = (typeof instagramInsightsSections)[number];

export type InstagramViewsByFollowType = {
  followers: number | null;
  nonFollowers: number | null;
};

export type InstagramAudienceDemographic = {
  dimensions: Record<string, string>;
  value: number;
};

export type InstagramAudienceReport = {
  timeframe: "last_30_days";
  ageGender: InstagramAudienceDemographic[] | null;
  cities: InstagramAudienceDemographic[] | null;
  countries: InstagramAudienceDemographic[] | null;
};

export type InstagramInsightsContentPage = {
  period: InstagramInsightsPeriod;
  items: InstagramInsightContentItem[];
  nextAfter: string | null;
  hasMore: boolean;
};

export type InstagramAdsMetrics = {
  impressions: number | null;
  reach: number | null;
  spend: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
};

export type InstagramAdsReport = {
  period: InstagramInsightsPeriod;
  since: string;
  until: string;
  status: "available" | "empty" | "no_account" | "multiple_accounts" | "unavailable";
  accountName: string | null;
  currency: string | null;
  totals: InstagramAdsMetrics | null;
  campaigns: Array<InstagramAdsMetrics & { name: string; objective: string | null }>;
  hasMoreCampaigns: boolean;
};

export type InstagramInsightTotals = {
  views: number | null;
  reach: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  replies: number | null;
  reposts: number | null;
  follows: number | null;
  unfollows: number | null;
};

export type InstagramInsightContentItem = {
  id: string;
  format: "Feed" | "Carrossel" | "Reel" | "Story";
  caption: string;
  previewUrl: string | null;
  permalink: string | null;
  publishedAt: string;
  views: number | null;
  reach: number | null;
  totalInteractions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  replies: number | null;
  bioLinkClicks: number | null;
  storyLinkClicks: number | null;
};

export type PublicBioAnalyticsReport = {
  pageViews: number;
  linkClicks: number;
  galleryOpens: number;
  clickThroughRate: number | null;
  daily: Array<{ date: string; pageViews: number; linkClicks: number }>;
  topLinks: Array<{ id: string; label: string; clicks: number }>;
};

export type InstagramInsightStoredDay = {
  date: string;
  followersCount: number | null;
  mediaCount: number | null;
  settled: boolean;
  totals: InstagramInsightTotals;
  businessSuite: InstagramBusinessSuiteDailyMetrics | null;
};

export type InstagramBusinessSuiteDailyMetrics = {
  views: number | null;
  reach: number | null;
  contentInteractions: number | null;
  profileVisits: number | null;
  profileLinkClicks: number | null;
  followers: number | null;
};

export type InstagramBusinessSuiteTotals = InstagramBusinessSuiteDailyMetrics & {
  coveredDays: number;
};

export type InstagramInsightContentSnapshot = InstagramInsightContentItem & {
  stage: "first48h" | "day7" | "day30";
};

export type InstagramInsightsHistory = {
  daily: InstagramInsightStoredDay[];
  stories: InstagramInsightContentItem[];
  contentSnapshots: InstagramInsightContentSnapshot[];
};

export type InstagramInsightsReport = {
  range: { period: InstagramInsightsPeriod; days: number; since: string; until: string };
  profile: InstagramPublishedFeedProfile & {
    followersCount: number | null;
    mediaCount: number | null;
  };
  totals: InstagramInsightTotals;
  viewsByFollowType: InstagramViewsByFollowType;
  reachSeries: Array<{ date: string; value: number }>;
  businessSuiteTotals: InstagramBusinessSuiteTotals;
  content: InstagramInsightContentItem[];
  activeStories: InstagramInsightContentItem[];
  history: InstagramInsightsHistory;
  bio: PublicBioAnalyticsReport;
  notices: string[];
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
  paused: "Pausada",
  processing: "Publicando",
  published: "Publicada",
  failed: "Falhou",
  manual_review: "Revisão necessária",
  cancelled: "Cancelada",
};
