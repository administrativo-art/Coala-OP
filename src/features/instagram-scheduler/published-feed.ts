import type {
  InstagramPublishedFeedItem,
  InstagramPublishedFeedProfile,
} from "./contracts";

type GraphMedia = {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_product_type?: unknown;
  media_url?: unknown;
  thumbnail_url?: unknown;
  permalink?: unknown;
  timestamp?: unknown;
  children?: { data?: GraphMedia[] } | unknown;
};

type GraphProfile = {
  username?: unknown;
  profile_picture_url?: unknown;
};

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function childrenOf(media: GraphMedia) {
  if (!media.children || typeof media.children !== "object") return [];
  const data = (media.children as { data?: unknown }).data;
  return Array.isArray(data) ? data as GraphMedia[] : [];
}

export function parseInstagramPublishedProfile(value: GraphProfile): InstagramPublishedFeedProfile {
  return {
    username: text(value.username).trim() || "coalashakes",
    profilePictureUrl: httpsUrl(value.profile_picture_url),
  };
}

export function parseInstagramPublishedFeed(
  value: { data?: unknown },
  limit = 18,
): InstagramPublishedFeedItem[] {
  const data = Array.isArray(value.data) ? value.data as GraphMedia[] : [];

  return data.flatMap((media): InstagramPublishedFeedItem[] => {
    const id = text(media.id).trim();
    const permalink = httpsUrl(media.permalink);
    const publishedAt = text(media.timestamp);
    const timestamp = Date.parse(publishedAt);
    const mediaType = text(media.media_type).toUpperCase();
    const productType = text(media.media_product_type).toUpperCase();
    if (!id || !permalink || Number.isNaN(timestamp) || productType === "STORY") return [];

    const children = childrenOf(media);
    const firstChild = children[0];
    const previewUrl = mediaType === "CAROUSEL_ALBUM"
      ? httpsUrl(firstChild?.thumbnail_url) ?? httpsUrl(firstChild?.media_url)
      : httpsUrl(media.thumbnail_url) ?? httpsUrl(media.media_url);
    if (!previewUrl) return [];

    const format = mediaType === "CAROUSEL_ALBUM"
      ? "carousel"
      : productType === "REELS" || mediaType === "VIDEO"
        ? "reel"
        : "feed_image";

    return [{
      id,
      format,
      caption: text(media.caption),
      previewUrl,
      permalink,
      publishedAt: new Date(timestamp).toISOString(),
      childrenCount: format === "carousel" ? Math.max(children.length, 2) : 1,
    }];
  })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, Math.max(0, limit));
}
