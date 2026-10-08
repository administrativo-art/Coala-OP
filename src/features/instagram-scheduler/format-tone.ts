import type { InstagramPublicationFormat, InstagramPublicationStatus } from "./contracts";
import type { StatusPillVariant } from "@/components/ui/status-pill";

/** Cor de cada formato pelos tokens do guia (a paleta de `formatTheme` segue no editor e na criação). */
export const formatTone: Record<InstagramPublicationFormat, { chip: string; dot: string; tile: string }> = {
  feed_image: { chip: "bg-ds-info-bg text-ds-info", dot: "bg-ds-info", tile: "bg-ds-info-bg" },
  carousel: { chip: "bg-ds-warn-bg text-ds-warn", dot: "bg-ds-warn", tile: "bg-ds-warn-bg" },
  reel: { chip: "bg-ds-accent-soft text-ds-accent-ink", dot: "bg-ds-accent", tile: "bg-ds-accent-soft" },
  story: { chip: "bg-ds-muted text-ds-ink", dot: "bg-ds-ink", tile: "bg-ds-muted" },
};

export const publicationStatusVariant: Record<InstagramPublicationStatus, StatusPillVariant> = {
  uploading: "info",
  scheduled: "info",
  processing: "warn",
  paused: "neutral",
  published: "ok",
  failed: "danger",
  manual_review: "warn",
  cancelled: "neutral",
};
