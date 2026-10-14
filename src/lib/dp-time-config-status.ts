export type DPTimeConfigListStatus = 'active' | 'archived';

type StatusLike = {
  status?: string;
  isArchived?: boolean;
};

export function isArchivedTimeConfig(item: StatusLike) {
  return item.isArchived === true || item.status === 'archived';
}

export function filterTimeConfigsByListStatus<T extends StatusLike>(items: T[], status: DPTimeConfigListStatus) {
  return items.filter((item) => isArchivedTimeConfig(item) === (status === 'archived'));
}

export function timeConfigListCounts(items: StatusLike[]) {
  const archived = items.filter(isArchivedTimeConfig).length;
  return { active: items.length - archived, archived };
}
