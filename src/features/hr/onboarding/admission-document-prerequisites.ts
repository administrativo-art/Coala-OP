const CBO_PATTERN = /^\d{4}-\d{2}$/;

export function admissionDocumentJobRoleCbo(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CBO_PATTERN.test(trimmed) ? trimmed : null;
}

export function missingAdmissionDocumentJobRoleCbo(params: {
  generateSignatureDocuments: boolean;
  jobRoleCbo: unknown;
}) {
  return params.generateSignatureDocuments
    && admissionDocumentJobRoleCbo(params.jobRoleCbo) === null;
}
