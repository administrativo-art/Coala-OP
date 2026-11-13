import type { PersonLinkedUser } from "@/lib/hr/person-link";

/** Only exact identifiers already linked to the selected person; never infer by name. */
export function employeeArchiveIds(person: PersonLinkedUser): string[] {
  return [...new Set([person.id, person.hrEmployeeId, person.registrationIdBizneo].filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))];
}

export function employeeArchiveChildFolders(paths: readonly string[][], parent: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => parent.every((part, index) => path[index] === part)).map((path) => path[parent.length]).filter(Boolean))];
}

type ArchiveNamedDocument = {
  archiveName?: string | null;
  category?: string | null;
  displayName?: string | null;
  documentType?: string | null;
  documentTypeCode?: string | null;
  destinationTrail?: readonly string[] | null;
  originalName?: string | null;
};

function archiveDates(document: ArchiveNamedDocument): string[] {
  const source = [...(document.destinationTrail ?? []), document.displayName ?? "", document.documentType ?? ""].join(" ");
  const dates: string[] = [];
  for (const match of source.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)) dates.push(`${match[1]}/${match[2]}/${match[3]}`);
  for (const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) dates.push(`${match[3]}/${match[2]}/${match[1]}`);
  return [...new Set(dates)];
}

function archiveTypeLabel(document: ArchiveNamedDocument): string {
  if (document.documentTypeCode === "MEDICAL_CERTIFICATE") return "Atestado";
  if (document.documentTypeCode === "DISCIPLINARY_WARNING") return "Advertência";
  return (document.documentType || document.displayName || "Documento")
    .replace(/^Afastamento\s*[—:-]?\s*/i, "")
    .replace(/\s*[—-]\s*\d{2}\/\d{2}\/20\d{2}.*$/, "")
    .trim();
}

const ASO_LABELS: Record<string, string> = {
  ASO_ADMISSION: "ASO admissional",
  ASO_PERIODIC: "ASO periódico",
  ASO_RETURN: "ASO de retorno",
  ASO_RISK_CHANGE: "ASO de mudança de risco",
  ASO_DISMISSAL: "ASO demissional",
};

/** Display-only archive label; canonical classification and download name stay unchanged. */
export function employeeArchiveDocumentName(document: ArchiveNamedDocument): string {
  const name = document.archiveName || document.displayName || document.documentType || document.originalName || "Documento";
  if (document.archiveName) return name;
  const dates = archiveDates(document);
  if (document.category === "leaves" && dates.length) {
    return `${dates[0]}${dates[1] ? ` a ${dates[1]}` : ""} — ${archiveTypeLabel(document)}`;
  }
  if (document.category === "warnings" && dates.length) return `${dates[0]} — ${archiveTypeLabel(document)}`;
  const asoLabel = document.documentTypeCode ? ASO_LABELS[document.documentTypeCode] : null;
  if (asoLabel) return dates[0] ? `${asoLabel} — ${dates[0]}` : asoLabel;
  if (document.documentTypeCode === "PROBATION_CONTRACT" || /^Contrato de experiência(?=\b|\s*—)/i.test(name)) {
    return name.replace(/^Contrato de experiência(?=\b|\s*—)/i, "Contrato de trabalho");
  }
  return name;
}

type PackageReference = { id: string; employeeId?: string | null; source?: string | null; documentTypeCode?: string | null; contentHash?: string | null; signatureRequestId?: string | null; sourceOnboardingId?: string | null; originalName?: string | null; mimeType?: string | null; size?: number | null; category?: string | null; accessLevel?: string | null; accessPolicyId?: string | null; publication?: unknown; resolvedVisibility?: unknown; folderCode?: string | null; destinationTrail?: unknown; status?: string | null; version?: number | null; archiveName?: string | null; archivePath?: unknown };

/** Stable identity of references that project the same signed admission package. */
export function signedAdmissionArchiveGroupKey(doc: PackageReference): string | null {
  const samePackage = doc.documentTypeCode === "ADMISSION_PACKAGE" && doc.source === "autentique_signature" && doc.employeeId
    && doc.signatureRequestId && doc.sourceOnboardingId && /^[a-f0-9]{64}$/i.test(doc.contentHash ?? "") && doc.mimeType === "application/pdf";
  return samePackage ? JSON.stringify([doc.employeeId, doc.signatureRequestId, doc.sourceOnboardingId, doc.contentHash, doc.size,
    doc.category, doc.accessLevel, doc.accessPolicyId, doc.publication ?? null, doc.resolvedVisibility ?? null, doc.folderCode,
    doc.destinationTrail, doc.status, doc.version, doc.archiveName ?? null, doc.archivePath ?? null]) : null;
}

/** Group only authorized references to the same signed admission package; never delete or merge stored records. */
export function groupSignedAdmissionReferences<T extends PackageReference>(documents: readonly T[]): Array<T & { archiveReferences: string[]; archiveSourceNames: string[] }> {
  const groups = new Map<string, Array<T>>();
  for (const doc of documents) {
    const key = signedAdmissionArchiveGroupKey(doc) ?? `document:${doc.id}`;
    const members = groups.get(key) ?? [];
    members.push(doc); groups.set(key, members);
  }
  return [...groups.values()].map((members) => {
    members.sort((a, b) => a.id.localeCompare(b.id));
    return { ...members[0], archiveReferences: members.map((doc) => doc.id), archiveSourceNames: members.map((doc) => doc.originalName ?? "") };
  });
}

/** Published view of the same signed package. Publication times may differ across legacy references;
 * status must already have been checked by the authoritative caller. Keep the representative's original fields. */
export function groupPublishedAdmissionReferences<T extends PackageReference>(documents: readonly T[]): Array<T & { archiveReferences: string[]; archiveSourceNames: string[] }> {
  const originals = new Map(documents.map(document => [document.id, document]));
  return groupSignedAdmissionReferences(documents.map(document => ({
    ...document,
    publication: { status: (document.publication as { status?: unknown } | null)?.status ?? null },
  }))).map(group => ({ ...originals.get(group.id)!, archiveReferences: group.archiveReferences, archiveSourceNames: group.archiveSourceNames }));
}
