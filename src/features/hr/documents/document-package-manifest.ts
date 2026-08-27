export const DOCUMENT_COMPOSER_VERSION = "document-composer-v1";

export type DocumentPackageType =
  | "admission"
  | "receipt"
  | "uniform"
  | "generic";

export type DocumentPartyType =
  | "employee"
  | "company"
  | "external_person"
  | "external_company";

export type DocumentPartyRole =
  | "issuer"
  | "recipient"
  | "payer"
  | "payee"
  | "contractor"
  | "contracted"
  | "witness";

export type DocumentSignatureScope = "bundle" | "standalone" | "none";

export type DocumentPdfProfile =
  | "pdf-1.7"
  | "pdfa-1b"
  | "pdfa-2b"
  | "pdfa-3b";

export type DocumentPackageParty = {
  partyType: DocumentPartyType;
  role: DocumentPartyRole;
  ref: string | null;
  snapshot: {
    name: string;
    documentMasked: string;
  };
};

export type DocumentPackageManifestComponent = {
  componentId: string;
  templateId: string;
  templateVersion: number;
  title: string;
  order: number;
  startPage: number;
  endPage: number;
  contentHash: string;
  artifactHash: string;
  sourceDocxHash: string | null;
  signatureScope: DocumentSignatureScope;
};

export type DocumentPackageManifest = {
  schemaVersion: 1;
  packageId: string;
  packageType: DocumentPackageType;
  protocol: string;
  parties: DocumentPackageParty[];
  components: DocumentPackageManifestComponent[];
  totalPages: number;
  letterheadVersion: string;
  composerVersion: typeof DOCUMENT_COMPOSER_VERSION;
  pdfProfile: DocumentPdfProfile;
  packageHash: string;
  generatedAt: string;
};

export type DocumentSignatureEnvelope = {
  schemaVersion: 1;
  packageId: string;
  packageHash: string;
  provider: "autentique";
  providerDocumentId: string;
  sentAt: string;
  completedAt: string | null;
  signedHash: string | null;
  signatureReportHash: string | null;
  confirmedByEventId: string | null;
};

export function canonicalManifestJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalManifestJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${canonicalManifestJson(item)}`,
    )
    .join(",")}}`;
}
