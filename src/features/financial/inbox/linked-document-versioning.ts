export function linkedDocumentVersionId(sourceFingerprint: string, documentSha256: string) {
  if (!/^[a-f0-9]{64}$/i.test(sourceFingerprint) || !/^[a-f0-9]{64}$/i.test(documentSha256)) {
    throw new Error("Identidade inválida para a versão do documento vinculado.");
  }
  return `link_${sourceFingerprint.slice(0, 12).toLowerCase()}_${documentSha256.slice(0, 12).toLowerCase()}`;
}

export function shouldArchiveLinkedDocumentVersion(
  attachments: Array<{ sha256?: string | null }>,
  documentSha256: string,
) {
  return !attachments.some((attachment) => attachment.sha256?.toLowerCase() === documentSha256.toLowerCase());
}
