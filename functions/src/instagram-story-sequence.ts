export type StorySequenceItemProgress<TTimestamp> = {
  containerId?: string;
  publishRequestStartedAt?: TTimestamp;
  publishedMediaId?: string;
  publishedAt?: TTimestamp;
};

export type InstagramPublicationProgress<TTimestamp> = {
  childContainerIds?: string[];
  parentContainerId?: string;
  publishRequestStartedAt?: TTimestamp;
  publishedMediaId?: string;
  storyItems?: StorySequenceItemProgress<TTimestamp>[];
};

export function hasAmbiguousInstagramPublish<TTimestamp>(
  progress: InstagramPublicationProgress<TTimestamp> | undefined,
) {
  if (!progress) return false;
  if (progress.publishRequestStartedAt && !progress.publishedMediaId) return true;
  return (progress.storyItems ?? []).some(
    (item) => Boolean(item.publishRequestStartedAt && !item.publishedMediaId),
  );
}

export function normalizeInstagramStoryProgress<TTimestamp>(
  mediaCount: number,
  existing: InstagramPublicationProgress<TTimestamp> | undefined,
) {
  const current = existing ?? {};
  const storyItems = Array.from(
    { length: mediaCount },
    (_, index) => ({ ...(current.storyItems?.[index] ?? {}) }),
  );

  // Compatibilidade com um Story iniciado pela versão que persistia um único contêiner.
  if (storyItems[0] && !storyItems[0].containerId && current.parentContainerId) {
    storyItems[0].containerId = current.parentContainerId;
    storyItems[0].publishRequestStartedAt = current.publishRequestStartedAt;
    storyItems[0].publishedMediaId = current.publishedMediaId;
  }

  return { ...current, storyItems };
}
