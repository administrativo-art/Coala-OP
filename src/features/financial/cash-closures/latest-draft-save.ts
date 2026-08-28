export type RevisionedDraft<T> = {
  revision: number;
  value: T;
};

type PersistLatestDraftOptions<TDraft, TResult> = {
  read: () => RevisionedDraft<TDraft> | null;
  persist: (draft: TDraft) => Promise<TResult>;
  commit: (result: TResult) => void;
};

/**
 * Serializes draft writes and only commits the response that represents the
 * latest local revision. If the user edits while a request is in flight, the
 * stale response is discarded and the newest draft is persisted next.
 */
export async function persistLatestDraft<TDraft, TResult>({
  read,
  persist,
  commit,
}: PersistLatestDraftOptions<TDraft, TResult>): Promise<boolean> {
  while (true) {
    const draft = read();
    if (!draft) return false;

    const result = await persist(draft.value);
    const latest = read();
    if (!latest) return false;
    if (latest.revision !== draft.revision) continue;

    commit(result);
    return true;
  }
}

export function isCurrentDraftRevision(requestRevision: number, currentRevision: number) {
  return requestRevision === currentRevision;
}
