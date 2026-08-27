export function isPreviewableDocumentContentType(
  contentType: string | null,
  options: { allowImage?: boolean } = {},
) {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'application/pdf') return true;
  return options.allowImage === true && normalized.startsWith('image/');
}
