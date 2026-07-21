type TimestampLike = {
  toMillis?: () => number;
  toDate?: () => Date;
  seconds?: number;
};

export type CompanyDocumentMetadata = {
  id: string;
  title?: unknown;
  originalName?: unknown;
  standardizedName?: unknown;
  category?: unknown;
  mimeType?: unknown;
  status?: unknown;
  storagePath?: unknown;
  uploadedAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
};

function normalized(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';
}

function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (!value || typeof value !== 'object') return 0;
  const timestamp = value as TimestampLike;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime();
  return typeof timestamp.seconds === 'number' ? timestamp.seconds * 1000 : 0;
}

function isSocialContract(document: CompanyDocumentMetadata) {
  const searchableName = [document.title, document.originalName, document.standardizedName]
    .map(normalized)
    .join(' ');
  return searchableName.includes('contrato social');
}

export function selectLatestSocialContract<T extends CompanyDocumentMetadata>(documents: T[]): T | null {
  const eligible = documents.filter((document) => (
    !document.deletedAt
    && normalized(document.category) === 'societario'
    && (!document.status || normalized(document.status) === 'active')
    && normalized(document.mimeType) === 'application/pdf'
    && typeof document.storagePath === 'string'
    && document.storagePath.trim().length > 0
    && isSocialContract(document)
  ));

  eligible.sort((left, right) => {
    const leftTime = timestampMillis(left.uploadedAt) || timestampMillis(left.updatedAt);
    const rightTime = timestampMillis(right.uploadedAt) || timestampMillis(right.updatedAt);
    return rightTime - leftTime;
  });

  return eligible[0] ?? null;
}
